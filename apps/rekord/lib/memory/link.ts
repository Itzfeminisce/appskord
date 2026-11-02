import type { MemoryItem, Person } from './types';

export interface Seen { name?: string; email?: string }
export interface PersonMatch { person?: Person; suggestions: Person[] }

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const firstName = (s: string) => clean(s).split(' ')[0];

/** Matches by email, then exact name, then alias. Ambiguous or partial hits come back as suggestions, never a guess. */
export function matchPerson(seen: Seen, people: Person[]): PersonMatch {
  if (seen.email) {
    const email = clean(seen.email);
    const hit = people.find((p) => p.email && clean(p.email) === email);
    if (hit) return { person: hit, suggestions: [] };
  }
  if (!seen.name) return { suggestions: [] };
  const name = clean(seen.name);
  for (const names of [(p: Person) => [p.name], (p: Person) => p.aliases]) {
    const hits = people.filter((p) => names(p).some((n) => clean(n) === name));
    // An email that disagrees means a different person with the same name.
    const usable = seen.email ? hits.filter((p) => !p.email) : hits;
    if (usable.length === 1) return { person: usable[0], suggestions: [] };
    if (hits.length > 0) return { suggestions: hits };
  }
  const first = firstName(name);
  return { suggestions: people.filter((p) => firstName(p.name) === first) };
}

/** Pairs that may be one person: someone without an email whose name is another's first name or full name. */
export function mergeSuggestions(people: Person[]): [Person, Person][] {
  const pairs = new Map<string, [Person, Person]>();
  for (const loose of people.filter((p) => !p.email)) {
    const name = clean(loose.name);
    for (const other of people) {
      if (other === loose || !(clean(other.name) === name || firstName(other.name) === name)) continue;
      const key = [loose.id, other.id].sort().join('\u0000');
      if (!pairs.has(key)) pairs.set(key, [loose, other]);
    }
  }
  return [...pairs.values()];
}

export interface ItemCandidate { item: MemoryItem; score: number }
export type SameItem = (fresh: MemoryItem, earlier: MemoryItem) => Promise<boolean>;

/** The earlier item a new one continues: best similar candidate of the same kind that the AI says yes to. */
export async function linkItem(fresh: MemoryItem, candidates: ItemCandidate[], same: SameItem, minScore = 0.75): Promise<MemoryItem | undefined> {
  const ranked = candidates
    .filter((c) => c.score >= minScore && c.item.kind === fresh.kind && c.item.id !== fresh.id)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  for (const c of ranked) if (await same(fresh, c.item)) return c.item;
  return undefined;
}

export interface ForgetPlan { deleteIds: string[]; unlinked: MemoryItem[]; promises: number; decisionLinks: number }

/** What forgetting a person removes: promises they owe or are owed go; other items only lose the link. */
export function planForget(personId: string, items: MemoryItem[], now: number): ForgetPlan {
  const touched = items.filter((i) => i.personIds.includes(personId) || i.ownerId === personId || i.toId === personId);
  const owesOrOwed = (i: MemoryItem) => i.kind === 'promise' && (i.ownerId === personId || i.toId === personId);
  const gone = touched.filter(owesOrOwed);
  const unlinked = touched
    .filter((i) => !owesOrOwed(i))
    .map((i) => ({
      ...i,
      personIds: i.personIds.filter((id) => id !== personId),
      ownerId: i.ownerId === personId ? undefined : i.ownerId,
      toId: i.toId === personId ? undefined : i.toId,
      updatedAt: now,
    }));
  return {
    deleteIds: gone.map((i) => i.id),
    unlinked,
    promises: gone.length,
    decisionLinks: unlinked.filter((i) => i.kind === 'decision').length,
  };
}

/** One person from two: keeps `keep`, takes the other's aliases, meetings and missing details. */
export function mergedPerson(keep: Person, drop: Person, now: number): Person {
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    ...keep,
    email: keep.email ?? drop.email,
    company: keep.company ?? drop.company,
    aliases: uniq([...keep.aliases, drop.name, ...drop.aliases]).filter((a) => a !== keep.name),
    meetingIds: uniq([...keep.meetingIds, ...drop.meetingIds]),
    createdAt: Math.min(keep.createdAt, drop.createdAt),
    updatedAt: now,
  };
}

/** Rewrites an item's links from one person id to another. */
export function relinkItem(item: MemoryItem, fromId: string, toId: string, now: number): MemoryItem {
  return {
    ...item,
    ownerId: item.ownerId === fromId ? toId : item.ownerId,
    toId: item.toId === fromId ? toId : item.toId,
    personIds: [...new Set(item.personIds.map((id) => (id === fromId ? toId : id)))],
    updatedAt: now,
  };
}
