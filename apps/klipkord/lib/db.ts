import { createDB, folderHandle, type DBSchema } from '@appskord/platform';
import { docsOf, type SearchDoc } from './search';
import type { Project } from './project/types';
import type { Recording, TranscriptModel } from './types';

interface KlipkordDB extends DBSchema {
  recordings: { key: string; value: Recording; indexes: { status: string } };
  // File System Access handles survive only in IndexedDB.
  handles: { key: string; value: FileSystemDirectoryHandle };
  // Searchable pieces per recording; the in-memory index is rebuilt from these.
  searchIndex: { key: string; value: SearchEntry };
  // v3 edit project per recording, key = recording id.
  projects: { key: string; value: Project };
}

export interface SearchEntry { id: string; docs: SearchDoc[] }

export const DB_VERSION = 4;

const appDB = createDB<KlipkordDB>({
  name: 'klipkord',
  version: DB_VERSION,
  // Each version only adds stores or fills new fields, so earlier data is kept.
  async upgrade(db, oldVersion, _newVersion, tx) {
    if (oldVersion < 1) {
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('status', 'status');
      db.createObjectStore('handles');
    }
    if (oldVersion >= 1 && oldVersion < 2) {
      for (let cursor = await tx.objectStore('recordings').openCursor(); cursor; cursor = await cursor.continue()) {
        await cursor.update(withV2Fields(cursor.value));
      }
    }
    if (oldVersion < 3) db.createObjectStore('searchIndex', { keyPath: 'id' });
    if (oldVersion < 4) db.createObjectStore('projects', { keyPath: 'id' });
  },
});

export const getDB = appDB.get;

/**
 * Fills v2 fields on a v1 record. v1 kept no flag for the base pass, so a ready record with nothing pending
 * counts as 'full' (its after-stop pass finished); anything else keeps the live text.
 */
export function withV2Fields(r: Recording): Recording {
  if (r.transcriptModel) return r;
  const transcriptModel: TranscriptModel = r.status === 'ready' && !r.transcriptPending ? 'full' : 'live';
  return { ...r, transcriptModel };
}

/** Test helper: close and forget the cached connection. */
export const closeDB = appDB.close;

export async function putRecording(r: Recording): Promise<void> {
  const tx = (await getDB()).transaction(['recordings', 'searchIndex'], 'readwrite');
  await Promise.all([tx.objectStore('recordings').put(r), tx.objectStore('searchIndex').put({ id: r.id, docs: docsOf(r) }), tx.done]);
}
export type RecordingPatch = Partial<Omit<Recording, 'id'>>;

/**
 * Reads and writes one record inside a single readwrite transaction, so writers in other contexts
 * never overwrite each other's fields. Each writer patches only the fields it owns.
 * Returns the stored record, or undefined when it is gone (or the function returns null to skip).
 */
export async function updateRecording(
  id: string,
  change: RecordingPatch | ((rec: Recording) => RecordingPatch | null),
): Promise<Recording | undefined> {
  const tx = (await getDB()).transaction(['recordings', 'searchIndex'], 'readwrite');
  const rec = await tx.objectStore('recordings').get(id);
  const patch = rec && (typeof change === 'function' ? change(rec) : change);
  const next = rec && patch ? { ...rec, ...patch, id } : undefined;
  if (next) await Promise.all([tx.objectStore('recordings').put(next), tx.objectStore('searchIndex').put({ id, docs: docsOf(next) })]);
  await tx.done;
  return next;
}
export async function getRecording(id: string): Promise<Recording | undefined> {
  return (await getDB()).get('recordings', id);
}
/** Newest first by createdAt. */
export async function listRecordings(): Promise<Recording[]> {
  const all = await (await getDB()).getAll('recordings');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
/** Deletes the record and its edit project; remove its video with videoStore.remove(id). */
export async function deleteRecording(id: string): Promise<void> {
  const tx = (await getDB()).transaction(['recordings', 'searchIndex', 'projects'], 'readwrite');
  await Promise.all([
    tx.objectStore('recordings').delete(id), tx.objectStore('searchIndex').delete(id), tx.objectStore('projects').delete(id), tx.done,
  ]);
}

/** Every stored entry of the search index. */
export async function listSearchEntries(): Promise<SearchEntry[]> {
  return (await getDB()).getAll('searchIndex');
}
/**
 * Indexes the ready recordings saved before search existed, once, newest first.
 * `onProgress` gets (recordings now searchable, recordings in all).
 */
export async function backfillSearchIndex(onProgress: (done: number, total: number) => void = () => {}): Promise<void> {
  const db = await getDB();
  const ready = (await listRecordings()).filter((r) => r.status === 'ready');
  const have = new Set(await db.getAllKeys('searchIndex'));
  const missing = ready.filter((r) => !have.has(r.id));
  let done = ready.length - missing.length;
  onProgress(done, ready.length);
  for (const r of missing) {
    // Re-read inside the write so a recording changed meanwhile is indexed as it now is.
    await updateRecording(r.id, () => ({}));
    onProgress(++done, ready.length);
  }
}
/** Recordings left with status 'unfinished', newest first (shown by Recovered at start-up). */
export async function listUnfinished(): Promise<Recording[]> {
  const all = await (await getDB()).getAllFromIndex('recordings', 'status', 'unfinished');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
/**
 * Browser start-up with no offscreen document: anything still 'recording' or 'paused' was cut off,
 * so mark it 'unfinished'. A 'processing' record has no live transcript any more, so it stops waiting on one.
 */
export async function markInterrupted(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction('recordings', 'readwrite');
  const index = tx.store.index('status');
  const cut = [...(await index.getAll('recording')), ...(await index.getAll('paused'))];
  const stalled = (await index.getAll('processing')).filter((r) => r.transcriptPending);
  await Promise.all([
    ...cut.map((r) => tx.store.put({ ...r, status: 'unfinished', transcriptPending: false })),
    ...stalled.map((r) => tx.store.put({ ...r, transcriptPending: false })),
    tx.done,
  ]);
  return cut.length;
}

const folder = folderHandle(getDB);
export const getFolderHandle = folder.get;
export const putFolderHandle = folder.put;
export const clearFolderHandle = folder.clear;
