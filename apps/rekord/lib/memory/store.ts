import { getDB } from '../db';
import { planForget, mergedPerson, relinkItem, type ForgetPlan } from './link';
import { canApply, transition } from './promise';
import { isOpenLoop } from './rank';
import type { Agenda, ItemKind, ItemStatus, LedgerEntry, MemoryItem, Person, VectorRow } from './types';

// People
export async function getPerson(id: string): Promise<Person | undefined> { return (await getDB()).get('people', id); }
export async function putPerson(p: Person): Promise<void> { await (await getDB()).put('people', p); }
export async function listPeople(): Promise<Person[]> { return (await getDB()).getAll('people'); }
export async function personByEmail(email: string): Promise<Person | undefined> {
  return (await getDB()).getFromIndex('people', 'email', email);
}

// Items
export async function getItem(id: string): Promise<MemoryItem | undefined> { return (await getDB()).get('items', id); }
/** Owner and recipient always sit in `personIds`, so the person index finds the item. */
export function withPeople(i: MemoryItem): MemoryItem {
  const ids = [i.ownerId, i.toId].filter((id): id is string => !!id && id !== 'me');
  return ids.every((id) => i.personIds.includes(id)) ? i : { ...i, personIds: [...new Set([...i.personIds, ...ids])] };
}
export async function putItem(i: MemoryItem): Promise<void> { await (await getDB()).put('items', withPeople(i)); }
/** Marks `oldId` replaced by `newId` and links both ways, in one transaction. False when the pair does not allow it. */
export async function replaceDecision(oldId: string, newId: string, now: number): Promise<boolean> {
  const tx = (await getDB()).transaction('items', 'readwrite');
  const [old, fresh] = [await tx.store.get(oldId), await tx.store.get(newId)];
  if (!old || !fresh || oldId === newId || !canApply(old, { type: 'replace', byId: newId })) { await tx.done; return false; }
  await Promise.all([
    tx.store.put(transition(old, { type: 'replace', byId: newId }, now)),
    tx.store.put({ ...fresh, replacesId: oldId, updatedAt: now }),
    tx.done,
  ]);
  return true;
}

/** Undoes a replace: the old decision is open again and neither side points at the other. */
export async function undoReplaceDecision(oldId: string, now: number): Promise<boolean> {
  const tx = (await getDB()).transaction('items', 'readwrite');
  const old = await tx.store.get(oldId);
  if (!old || !canApply(old, { type: 'undoReplace' })) { await tx.done; return false; }
  const fresh = old.replacedById ? await tx.store.get(old.replacedById) : undefined;
  await Promise.all([
    tx.store.put(transition(old, { type: 'undoReplace' }, now)),
    ...(fresh && fresh.replacesId === oldId ? [tx.store.put({ ...fresh, replacesId: undefined, updatedAt: now })] : []),
    tx.done,
  ]);
  return true;
}
export async function deleteItem(id: string): Promise<void> { await (await getDB()).delete('items', id); }
export async function listItems(): Promise<MemoryItem[]> { return (await getDB()).getAll('items'); }
export async function itemsForMeeting(meetingId: string): Promise<MemoryItem[]> {
  return (await getDB()).getAllFromIndex('items', 'meetingId', meetingId);
}
export async function itemsByKind(kind: ItemKind): Promise<MemoryItem[]> { return (await getDB()).getAllFromIndex('items', 'kind', kind); }
export async function itemsByStatus(status: ItemStatus): Promise<MemoryItem[]> {
  return (await getDB()).getAllFromIndex('items', 'status', status);
}
export async function itemsForPerson(personId: string): Promise<MemoryItem[]> {
  return (await getDB()).getAllFromIndex('items', 'personId', personId);
}

/** Open and looks-done promises and questions that are not snoozed. */
export async function openLoops(now: number): Promise<MemoryItem[]> {
  const items = [...(await itemsByStatus('open')), ...(await itemsByStatus('looksDone'))];
  return items.filter((i) => isOpenLoop(i, now));
}

/** The decision with everything it replaced and what replaced it, oldest first. */
export async function decisionsChain(id: string): Promise<MemoryItem[]> {
  const start = await getItem(id);
  if (!start) return [];
  const chain = [start];
  const seen = new Set([start.id]);
  for (let at = start; at.replacesId && !seen.has(at.replacesId);) {
    const prev = await getItem(at.replacesId);
    if (!prev) break;
    seen.add(prev.id);
    chain.unshift(prev);
    at = prev;
  }
  for (let at = start; at.replacedById && !seen.has(at.replacedById);) {
    const next = await getItem(at.replacedById);
    if (!next) break;
    seen.add(next.id);
    chain.push(next);
    at = next;
  }
  return chain;
}

// Vectors, ledger, agendas
export async function putVectors(rows: VectorRow[]): Promise<void> {
  const tx = (await getDB()).transaction('vectors', 'readwrite');
  await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done]);
}
export async function vectorsForMeeting(meetingId: string): Promise<VectorRow[]> {
  return (await getDB()).getAllFromIndex('vectors', 'meetingId', meetingId);
}
export async function listVectors(): Promise<VectorRow[]> { return (await getDB()).getAll('vectors'); }

export async function putLedgerEntry(e: LedgerEntry): Promise<void> { await (await getDB()).put('ledger', e); }
export async function listLedger(): Promise<LedgerEntry[]> { return (await getDB()).getAll('ledger'); }
export async function ledgerForMeeting(meetingId: string): Promise<LedgerEntry[]> {
  return (await getDB()).getAllFromIndex('ledger', 'meetingId', meetingId);
}

export async function getAgenda(meetingKey: string): Promise<Agenda | undefined> { return (await getDB()).get('agendas', meetingKey); }
export async function putAgenda(a: Agenda): Promise<void> { await (await getDB()).put('agendas', a); }

// People actions, each run only after the user's click
/** Deletes the person and the promises they owe or are owed; other items lose the link. */
export async function forgetPerson(id: string, now: number): Promise<ForgetPlan> {
  const db = await getDB();
  const plan = planForget(id, await itemsForPerson(id), now);
  const tx = db.transaction(['people', 'items'], 'readwrite');
  const items = tx.objectStore('items');
  await Promise.all([
    tx.objectStore('people').delete(id),
    ...plan.deleteIds.map((key) => items.delete(key)),
    ...plan.unlinked.map((i) => items.put(i)),
    tx.done,
  ]);
  return plan;
}

/** Folds `dropId` into `keepId` and moves every item link across. */
export async function mergePeople(keepId: string, dropId: string, now: number): Promise<Person | undefined> {
  const [keep, drop] = [await getPerson(keepId), await getPerson(dropId)];
  if (!keep || !drop || keepId === dropId) return undefined;
  const merged = mergedPerson(keep, drop, now);
  const moved = (await itemsForPerson(dropId)).map((i) => relinkItem(i, dropId, keepId, now));
  const tx = (await getDB()).transaction(['people', 'items'], 'readwrite');
  await Promise.all([
    tx.objectStore('people').put(merged),
    tx.objectStore('people').delete(dropId),
    ...moved.map((i) => tx.objectStore('items').put(i)),
    tx.done,
  ]);
  return merged;
}

/** Moves the chosen meetings, and the person's items from them, to a new person. */
export async function splitPerson(id: string, meetingIds: string[], fresh: Pick<Person, 'id' | 'name'> & Partial<Person>, now: number): Promise<Person | undefined> {
  const from = await getPerson(id);
  if (!from) return undefined;
  const moving = new Set(meetingIds);
  const created: Person = {
    aliases: [], createdAt: now, ...fresh,
    meetingIds: from.meetingIds.filter((m) => moving.has(m)),
    updatedAt: now,
  };
  const kept: Person = { ...from, meetingIds: from.meetingIds.filter((m) => !moving.has(m)), updatedAt: now };
  const moved = (await itemsForPerson(id)).filter((i) => moving.has(i.meetingId)).map((i) => relinkItem(i, id, created.id, now));
  const tx = (await getDB()).transaction(['people', 'items'], 'readwrite');
  await Promise.all([
    tx.objectStore('people').put(kept),
    tx.objectStore('people').put(created),
    ...moved.map((i) => tx.objectStore('items').put(i)),
    tx.done,
  ]);
  return created;
}

/** Clears every v4 store; meetings and transcripts stay. */
export async function forgetAll(): Promise<void> {
  const stores = ['people', 'items', 'vectors', 'ledger', 'agendas'] as const;
  const tx = (await getDB()).transaction([...stores], 'readwrite');
  await Promise.all([...stores.map((s) => tx.objectStore(s).clear()), tx.done]);
}
