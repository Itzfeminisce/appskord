import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BrandKit, Clip, ExportJob } from './types';

interface MotikordDB extends DBSchema {
  clips: { key: string; value: Clip; indexes: { updatedAt: number } };
  // One brand kit, kept under BRAND_KEY.
  brandKit: { key: string; value: BrandKit };
  exportJobs: { key: string; value: ExportJob; indexes: { status: string } };
  // File System Access handles survive only in IndexedDB.
  handles: { key: string; value: FileSystemDirectoryHandle };
}

export const DB_VERSION = 1;
const FOLDER_KEY = 'folder';
const BRAND_KEY = 'brand';

let dbPromise: Promise<IDBPDatabase<MotikordDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MotikordDB>> {
  dbPromise ??= openDB<MotikordDB>('motikord', DB_VERSION, {
    // Each later version only adds stores or fills new fields, so earlier data is kept.
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('clips', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('brandKit');
        db.createObjectStore('exportJobs', { keyPath: 'id' }).createIndex('status', 'status');
        db.createObjectStore('handles');
      }
    },
  });
  return dbPromise;
}

/** Test helper: close and forget the cached connection. */
export async function closeDB(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

export async function putClip(clip: Clip): Promise<void> {
  await (await getDB()).put('clips', clip);
}
export async function getClip(id: string): Promise<Clip | undefined> {
  return (await getDB()).get('clips', id);
}
/**
 * Reads and writes one clip inside a single readwrite transaction, so the side panel and editor tab never
 * overwrite each other. Returns the stored clip, or undefined when it is gone (or `change` returns null).
 */
export async function updateClip(id: string, change: (clip: Clip) => Partial<Omit<Clip, 'id'>> | null): Promise<Clip | undefined> {
  const tx = (await getDB()).transaction('clips', 'readwrite');
  const clip = await tx.store.get(id);
  const patch = clip && change(clip);
  const next = clip && patch ? { ...clip, ...patch, id } : undefined;
  if (next) await tx.store.put(next);
  await tx.done;
  return next;
}
/** Newest change first. */
export async function listClips(): Promise<Clip[]> {
  return (await (await getDB()).getAllFromIndex('clips', 'updatedAt')).reverse();
}
/** Deletes the row only; remove its media with lib/media. */
export async function deleteClip(id: string): Promise<void> {
  await (await getDB()).delete('clips', id);
}

export async function getBrandKit(): Promise<BrandKit | undefined> {
  return (await getDB()).get('brandKit', BRAND_KEY);
}
export async function putBrandKit(kit: BrandKit): Promise<void> {
  await (await getDB()).put('brandKit', kit, BRAND_KEY);
}

export async function putExportJob(job: ExportJob): Promise<void> {
  await (await getDB()).put('exportJobs', job);
}
export async function getExportJob(id: string): Promise<ExportJob | undefined> {
  return (await getDB()).get('exportJobs', id);
}
export async function deleteExportJob(id: string): Promise<void> {
  await (await getDB()).delete('exportJobs', id);
}
/** Jobs with the given status, oldest first (Recovered lists the 'interrupted' ones). */
export async function listExportJobs(status: ExportJob['status']): Promise<ExportJob[]> {
  const jobs = await (await getDB()).getAllFromIndex('exportJobs', 'status', status);
  return jobs.sort((a, b) => a.startedAt - b.startedAt);
}
/** At start-up nothing is exporting yet, so any job still 'running' was cut off. Returns how many. */
export async function markInterruptedJobs(): Promise<number> {
  const tx = (await getDB()).transaction('exportJobs', 'readwrite');
  const running = await tx.store.index('status').getAll('running');
  await Promise.all([...running.map((j) => tx.store.put({ ...j, status: 'interrupted' })), tx.done]);
  return running.length;
}

export async function getFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return (await getDB()).get('handles', FOLDER_KEY);
}
export async function putFolderHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await (await getDB()).put('handles', handle, FOLDER_KEY);
}
export async function clearFolderHandle(): Promise<void> {
  await (await getDB()).delete('handles', FOLDER_KEY);
}
