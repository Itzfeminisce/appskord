import { createDB, type DBSchema, type IDBPDatabase } from '@appskord/platform';
import type { Agenda, AskTurn, CatchupStart, Chunk, LedgerEntry, Marker, Meeting, MemoryItem, Note, Person, RecordingMeta, RecordingPart, Segment, VectorRow } from './types';
import { addPart, locateTelling, newCatchupMeeting, partOfSeq, tellSeqBase, typedPart } from './catchup/session';
import type { CatchupAnswer, TellPart } from './catchup/types';

export interface RekordDB extends DBSchema {
  meetings: { key: string; value: Meeting };
  segments: { key: string; value: Segment; indexes: { meetingId: string } };
  notes: { key: string; value: Note; indexes: { meetingId: string } };
  markers: { key: string; value: Marker; indexes: { meetingId: string } };
  chunks: { key: string; value: Chunk; indexes: { meetingId: string; status: string } };
  asks: { key: string; value: AskTurn; indexes: { meetingId: string } };
  recordings: { key: string; value: RecordingPart; indexes: { meetingId: string } };
  recordingMeta: { key: string; value: RecordingMeta };
  people: { key: string; value: Person; indexes: { email: string } };
  items: { key: string; value: MemoryItem; indexes: { meetingId: string; kind: string; status: string; personId: string } };
  vectors: { key: string; value: VectorRow; indexes: { meetingId: string } };
  ledger: { key: string; value: LedgerEntry; indexes: { meetingId: string } };
  agendas: { key: string; value: Agenda };
}

type ChildStore = 'segments' | 'notes' | 'markers' | 'chunks' | 'asks' | 'recordings';
const CHILD_STORES: ChildStore[] = ['segments', 'notes', 'markers', 'chunks', 'asks', 'recordings'];
const MEMORY_STORES = ['items', 'vectors', 'ledger'] as const;

export const DB_VERSION = 3;

const appDB = createDB<RekordDB>({
  name: 'rekord',
  version: DB_VERSION,
  // Each step only adds stores, so data from earlier versions is kept.
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('meetings', { keyPath: 'id' });
      db.createObjectStore('segments', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('notes', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('markers', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
      chunks.createIndex('meetingId', 'meetingId');
      chunks.createIndex('status', 'status');
    }
    if (oldVersion < 2) {
      db.createObjectStore('asks', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('recordingMeta', { keyPath: 'meetingId' });
    }
    if (oldVersion < 3) {
      db.createObjectStore('people', { keyPath: 'id' }).createIndex('email', 'email');
      const items = db.createObjectStore('items', { keyPath: 'id' });
      items.createIndex('meetingId', 'meetingId');
      items.createIndex('kind', 'kind');
      items.createIndex('status', 'status');
      items.createIndex('personId', 'personIds', { multiEntry: true });
      db.createObjectStore('vectors', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('ledger', { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
      db.createObjectStore('agendas', { keyPath: 'meetingKey' });
    }
  },
});

export const getDB = appDB.get;

/** Test helper: close and forget the cached connection. */
export const closeDB = appDB.close;

// Meetings
export async function putMeeting(meeting: Meeting): Promise<void> {
  await (await getDB()).put('meetings', meeting);
}
export async function getMeeting(id: string): Promise<Meeting | undefined> {
  return (await getDB()).get('meetings', id);
}
/** Newest first by startedAt. */
export async function listMeetings(): Promise<Meeting[]> {
  const all = await (await getDB()).getAll('meetings');
  return all.sort((a, b) => b.startedAt - a.startedAt);
}
// v4.1 catch-up: one meeting, many parts
/**
 * Opens a telling: a new catch-up for the picked meeting, or (append) the same one again. Resolves the telling so far
 * (`offsetMs`), the index the new part will take in `told.parts` (`part`, its audio's seq base) and, on append, the
 * meeting's status before (`status`, for `undoCatchup`).
 */
export async function beginCatchup(start: CatchupStart, language: Meeting['language'], now: number): Promise<{ offsetMs: number; part: number; status?: Meeting['status'] }> {
  const existing = await getMeeting(start.meetingId);
  if (start.append) {
    if (existing?.source !== 'catchup' || !existing.told) throw new Error('No catch-up to add to.');
    const part = existing.told.parts.length;
    await deleteTellingAudioFrom(start.meetingId, part); // audio of a telling that never became a part
    await putMeeting({ ...existing, status: 'recording' });
    return { offsetMs: existing.told.ms, part, status: existing.status };
  }
  if (existing) throw new Error('This catch-up already exists.');
  await putMeeting(newCatchupMeeting(start.meetingId, start.picked, language, now));
  return { offsetMs: 0, part: 0 };
}

/** A telling that failed: a first one leaves no meeting behind; "Add more" puts back the meeting's `status`. */
export async function undoCatchup(start: CatchupStart, status: Meeting['status'] | undefined): Promise<void> {
  if (!start.append) return deleteMeeting(start.meetingId);
  const meeting = await getMeeting(start.meetingId);
  if (meeting && status) await putMeeting({ ...meeting, status });
}

/** One voice part's audio: `offsetMs` into the joined telling, `ms` long, one file. */
export interface TellingAudio { part: number; offsetMs: number; ms: number; blob: Blob }

/** Every voice part of a catch-up that still has audio, in telling order. Empty after "Delete audio of your telling". */
export async function listTellingAudio(meetingId: string): Promise<TellingAudio[]> {
  const [meeting, slices] = await Promise.all([getMeeting(meetingId), listRecordingParts(meetingId)]);
  const told = meeting?.told;
  if (!told) return [];
  const out: TellingAudio[] = [];
  let offsetMs = 0;
  for (const [part, p] of told.parts.entries()) {
    const mine = p.kind === 'voice' ? slices.filter((r) => partOfSeq(r.seq) === part) : [];
    if (mine.length > 0) out.push({ part, offsetMs, ms: p.ms, blob: new Blob(mine.map((r) => r.blob), { type: mine[0]!.mimeType }) });
    offsetMs += p.ms;
  }
  return out;
}

/** "Play your telling at atMs": the voice part's file and where to seek in it (ms). Null in a typed part or with no audio. */
export async function tellingAudioAt(meetingId: string, atMs: number): Promise<(TellingAudio & { seekMs: number }) | null> {
  const told = (await getMeeting(meetingId))?.told;
  const at = told && locateTelling(told.parts, atMs);
  if (!at) return null;
  const audio = (await listTellingAudio(meetingId)).find((a) => a.part === at.part);
  return audio ? { ...audio, seekMs: at.seekMs } : null;
}

/** "Delete audio of your telling": removes every voice part's audio, keeps the segments and sets `told.audioDeleted` (a later voice part with audio clears it). */
export async function deleteTellingAudio(meetingId: string): Promise<void> {
  await deleteRecording(meetingId);
  const meeting = await getMeeting(meetingId);
  if (meeting?.told) await putMeeting({ ...meeting, told: { ...meeting.told, audioDeleted: true } });
}

/** Removes the audio of voice part `part` and every later one (a failed write, or a telling that was never kept). */
export async function deleteTellingAudioFrom(meetingId: string, part: number): Promise<void> {
  const tx = (await getDB()).transaction('recordings', 'readwrite');
  const rows = await tx.store.index('meetingId').getAll(meetingId);
  await Promise.all([...rows.filter((r) => r.seq >= tellSeqBase(part)).map((r) => tx.store.delete(r.id)), tx.done]);
}

/** A pause ends a voice part: it joins the telling and the meeting keeps recording. `audio`: the part kept audio. */
export async function addCatchupPart(meetingId: string, part: TellPart, audio = false): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.told) return;
  await putMeeting({ ...meeting, told: addPart(meeting.told, part, undefined, audio) });
}

/**
 * Ends a telling: its last part (none when it ended paused) and voice answer join the meeting, which then goes to
 * processing. Times stay the meeting's.
 */
export async function endCatchupPart(meetingId: string, part: TellPart | null, answer?: CatchupAnswer, audio = false): Promise<void> {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.told) return;
  await putMeeting({ ...meeting, status: 'processing', told: addPart(meeting.told, part, answer, audio) });
}

/** Typed or pasted text: one typed part of `you` segments after the telling so far. False when the text is empty. */
export async function saveTypedPart(start: CatchupStart, text: string, language: Meeting['language'], now: number, newId: () => string): Promise<boolean> {
  const existing = start.append ? await getMeeting(start.meetingId) : undefined;
  const offsetMs = existing?.told?.ms ?? 0;
  const typed = typedPart(start.meetingId, text, offsetMs, now, newId);
  if (!typed) return false;
  const { status } = await beginCatchup(start, language, now);
  try {
    for (const s of typed.segments) await putSegment(s);
    await endCatchupPart(start.meetingId, typed.part, start.questionId ? { questionId: start.questionId, text: typed.segments.map((s) => s.text).join(' ') } : undefined);
  } catch (error) {
    if (start.append) await Promise.all(typed.segments.map((s) => deleteSegment(s.id))).catch(() => undefined);
    await undoCatchup(start, status).catch(() => undefined);
    throw error;
  }
  return true;
}

/** Deletes the meeting, its segments, notes, markers, chunks, asks and audio, and its memory items, vectors, ledger rows and agenda. */
export async function deleteMeeting(id: string): Promise<void> {
  const db = await getDB();
  const meeting = await db.get('meetings', id);
  const tx = db.transaction(['meetings', 'recordingMeta', 'agendas', 'people', ...CHILD_STORES, ...MEMORY_STORES], 'readwrite');
  const ops: Promise<unknown>[] = [
    tx.objectStore('meetings').delete(id),
    tx.objectStore('recordingMeta').delete(id),
    tx.objectStore('agendas').delete(id),
  ];
  // The agenda may be keyed by the calendar event instead of the meeting.
  if (meeting?.event?.id) ops.push(tx.objectStore('agendas').delete(meeting.event.id));
  const gone = new Set<string>();
  for (const name of [...CHILD_STORES, ...MEMORY_STORES]) {
    const store = tx.objectStore(name as 'segments');
    const keys = await store.index('meetingId').getAllKeys(id);
    if (name === 'items') for (const key of keys) gone.add(key as string);
    for (const key of keys) ops.push(store.delete(key));
  }
  // People lose the meeting; decisions that pointed at a deleted item reopen.
  const people = tx.objectStore('people');
  for (const p of await people.getAll()) {
    if (p.meetingIds.includes(id)) ops.push(people.put({ ...p, meetingIds: p.meetingIds.filter((m) => m !== id) }));
  }
  for (const i of await tx.objectStore('items').getAll()) {
    if (gone.has(i.id)) continue;
    const orphan = (i.replacedById && gone.has(i.replacedById)) || (i.replacesId && gone.has(i.replacesId));
    if (!orphan) continue;
    const next = { ...i };
    if (next.replacedById && gone.has(next.replacedById)) { delete next.replacedById; if (next.status === 'replaced') next.status = 'open'; }
    if (next.replacesId && gone.has(next.replacesId)) delete next.replacesId;
    ops.push(tx.objectStore('items').put(next));
  }
  await Promise.all([...ops, tx.done]);
}

// Child records, sorted by time
async function listBy<S extends ChildStore>(store: S, meetingId: string): Promise<RekordDB[S]['value'][]> {
  // Every child store has a string `meetingId` index; the cast bridges idb's per-store generic typing.
  const db = (await getDB()) as unknown as IDBPDatabase<Pick<RekordDB, 'segments'>>;
  return db.getAllFromIndex(store as 'segments', 'meetingId', meetingId) as Promise<RekordDB[S]['value'][]>;
}
const byStart = (a: { startMs: number }, b: { startMs: number }) => a.startMs - b.startMs;
const byAt = (a: { atMs: number }, b: { atMs: number }) => a.atMs - b.atMs;

export async function putSegment(s: Segment): Promise<void> { await (await getDB()).put('segments', s); }
export async function getSegment(id: string): Promise<Segment | undefined> { return (await getDB()).get('segments', id); }
export async function listSegments(meetingId: string): Promise<Segment[]> { return (await listBy('segments', meetingId)).sort(byStart); }
/** Whether any segment of the meeting has words; walks the index and stops at the first one. */
export async function hasSpeech(meetingId: string): Promise<boolean> {
  let cursor = await (await getDB()).transaction('segments').store.index('meetingId').openCursor(meetingId);
  while (cursor) {
    if (cursor.value.text.trim()) return true;
    cursor = await cursor.continue();
  }
  return false;
}
export async function deleteSegment(id: string): Promise<void> { await (await getDB()).delete('segments', id); }

export async function putNote(n: Note): Promise<void> { await (await getDB()).put('notes', n); }
export async function getNote(id: string): Promise<Note | undefined> { return (await getDB()).get('notes', id); }
export async function listNotes(meetingId: string): Promise<Note[]> { return (await listBy('notes', meetingId)).sort(byAt); }
export async function deleteNote(id: string): Promise<void> { await (await getDB()).delete('notes', id); }

export async function putMarker(m: Marker): Promise<void> { await (await getDB()).put('markers', m); }
export async function getMarker(id: string): Promise<Marker | undefined> { return (await getDB()).get('markers', id); }
export async function listMarkers(meetingId: string): Promise<Marker[]> { return (await listBy('markers', meetingId)).sort(byAt); }
export async function deleteMarker(id: string): Promise<void> { await (await getDB()).delete('markers', id); }

export async function putChunk(c: Chunk): Promise<void> { await (await getDB()).put('chunks', c); }
export async function getChunk(id: string): Promise<Chunk | undefined> { return (await getDB()).get('chunks', id); }
export async function listChunks(meetingId: string): Promise<Chunk[]> { return (await listBy('chunks', meetingId)).sort(byStart); }
export async function deleteChunk(id: string): Promise<void> { await (await getDB()).delete('chunks', id); }

/** Chunks with status 'pending', oldest first; optionally for one meeting. */
export async function pendingChunks(meetingId?: string): Promise<Chunk[]> {
  const all = await (await getDB()).getAllFromIndex('chunks', 'status', 'pending');
  const chunks = all.filter((c) => !meetingId || c.meetingId === meetingId);
  if (meetingId) return chunks.sort(byStart);
  // Across meetings startMs is a per-meeting offset: order by absolute time.
  const meetings = await (await getDB()).getAll('meetings');
  const started = new Map(meetings.map((m) => [m.id, m.startedAt]));
  const abs = (c: Chunk) => (started.get(c.meetingId) ?? 0) + c.startMs;
  return chunks.sort((a, b) => abs(a) - abs(b));
}

// Ask turns, oldest first
export async function putAsk(a: AskTurn): Promise<void> { await (await getDB()).put('asks', a); }
export async function listAsks(meetingId: string): Promise<AskTurn[]> {
  return (await listBy('asks', meetingId)).sort((a, b) => a.createdAt - b.createdAt);
}
export async function deleteAsk(id: string): Promise<void> { await (await getDB()).delete('asks', id); }

// Continuous recording: parts in seq order, plus pause metadata
export async function putRecordingPart(p: RecordingPart): Promise<void> { await (await getDB()).put('recordings', p); }
export async function listRecordingParts(meetingId: string): Promise<RecordingPart[]> {
  return (await listBy('recordings', meetingId)).sort((a, b) => a.seq - b.seq);
}
export async function getRecordingMeta(meetingId: string): Promise<RecordingMeta | undefined> {
  return (await getDB()).get('recordingMeta', meetingId);
}
export async function putRecordingMeta(m: RecordingMeta): Promise<void> { await (await getDB()).put('recordingMeta', m); }
/** Swaps a meeting's recorded parts for new ones in one transaction, so a failure leaves the old parts. */
export async function replaceRecordingParts(meetingId: string, parts: RecordingPart[]): Promise<void> {
  const tx = (await getDB()).transaction('recordings', 'readwrite');
  const keys = await tx.store.index('meetingId').getAllKeys(meetingId);
  await Promise.all([...keys.map((k) => tx.store.delete(k)), ...parts.map((p) => tx.store.put(p)), tx.done]);
}
/** Deletes a meeting's recorded audio parts and their metadata (the transcript is kept). */
export async function deleteRecording(meetingId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['recordings', 'recordingMeta'], 'readwrite');
  const keys = await tx.objectStore('recordings').index('meetingId').getAllKeys(meetingId);
  await Promise.all([
    ...keys.map((k) => tx.objectStore('recordings').delete(k)),
    tx.objectStore('recordingMeta').delete(meetingId),
    tx.done,
  ]);
}
