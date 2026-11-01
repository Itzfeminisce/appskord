import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createDB, folderHandle, type IDBPDatabase } from './db';
import { KLIPKORD, MOTIKORD, REKORD } from './fixtures/original';

const names = ['rekord', 'klipkord', 'motikord'];
const drop = (name: string) =>
  new Promise((done) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = done;
  });

// Builds the database with the pre-M5 code, writes rows, closes it.
async function buildOriginal(
  app: typeof REKORD | typeof KLIPKORD | typeof MOTIKORD,
  write: (db: IDBPDatabase) => Promise<unknown>,
) {
  const db = await openDB(app.name, app.version, { upgrade: app.upgrade as never });
  await write(db);
  db.close();
}

async function shape(db: IDBPDatabase) {
  const tx = db.transaction([...db.objectStoreNames], 'readonly');
  return [...db.objectStoreNames].map((s) => {
    const store = tx.objectStore(s);
    return { s, keyPath: store.keyPath, indexes: [...store.indexNames].map((i) => [i, store.index(i).keyPath]) };
  });
}

describe('createDB opens each app database built before M5', () => {
  afterEach(async () => {
    await Promise.all(names.map(drop));
  });

  it('Rekord: same name, version, stores and indexes; rows read back', async () => {
    await buildOriginal(REKORD, async (db) => {
      await db.put('meetings', { id: 'm1', startedAt: 1 });
      await db.put('segments', { id: 's1', meetingId: 'm1', startMs: 0, text: 'hello' });
      await db.put('chunks', { id: 'c1', meetingId: 'm1', status: 'pending', startMs: 0 });
      await db.put('recordingMeta', { meetingId: 'm1', paused: [] });
    });
    const before = await openDB('rekord', 2);
    const expected = await shape(before);
    before.close();
    const app = createDB<any>(REKORD as never);
    const db = await app.get();
    expect(db.name).toBe('rekord');
    expect(db.version).toBe(2);
    expect(await shape(db)).toEqual(expected);
    expect(await db.get('meetings', 'm1')).toEqual({ id: 'm1', startedAt: 1 });
    expect(await db.getAllFromIndex('segments', 'meetingId', 'm1')).toHaveLength(1);
    expect(await db.getAllFromIndex('chunks', 'status', 'pending')).toHaveLength(1);
    expect(await db.get('recordingMeta', 'm1')).toEqual({ meetingId: 'm1', paused: [] });
    await app.close();
  });

  it('Rekord: a v1 database upgrades through the same steps and keeps its rows', async () => {
    const v1 = await openDB('rekord', 1, {
      upgrade(db) {
        db.createObjectStore('meetings', { keyPath: 'id' });
        for (const s of ['segments', 'notes', 'markers'])
          db.createObjectStore(s, { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
        chunks.createIndex('meetingId', 'meetingId');
        chunks.createIndex('status', 'status');
      },
    });
    await v1.put('meetings', { id: 'm1', startedAt: 1 });
    v1.close();
    const app = createDB<any>(REKORD as never);
    const db = await app.get();
    expect([...db.objectStoreNames]).toContain('recordingMeta');
    expect(await db.get('meetings', 'm1')).toEqual({ id: 'm1', startedAt: 1 });
    await app.close();
  });

  it('Klipkord: current data, the folder handle and the search index read back', async () => {
    const handle = { kind: 'directory', name: 'Klipkord' } as unknown as FileSystemDirectoryHandle;
    await buildOriginal(KLIPKORD, async (db) => {
      await db.put('recordings', { id: 'r1', status: 'ready', createdAt: 1, transcriptModel: 'full' });
      await db.put('handles', handle, 'folder');
      await db.put('searchIndex', { id: 'r1', docs: [] });
    });
    const app = createDB<any>(KLIPKORD as never);
    const db = await app.get();
    expect(db.version).toBe(3);
    expect(await db.getAllFromIndex('recordings', 'status', 'ready')).toEqual([
      { id: 'r1', status: 'ready', createdAt: 1, transcriptModel: 'full' },
    ]);
    expect(await db.get('searchIndex', 'r1')).toEqual({ id: 'r1', docs: [] });
    expect(await folderHandle(app.get).get()).toEqual(handle);
    await app.close();
  });

  it('Klipkord: a v1 record gets its v2 fields on upgrade', async () => {
    const v1 = await openDB('klipkord', 1, {
      upgrade(db) {
        db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('status', 'status');
        db.createObjectStore('handles');
      },
    });
    await v1.put('recordings', { id: 'r1', status: 'ready', createdAt: 1 });
    v1.close();
    const app = createDB<any>(KLIPKORD as never);
    const db = await app.get();
    expect(await db.get('recordings', 'r1')).toEqual({
      id: 'r1',
      status: 'ready',
      createdAt: 1,
      transcriptModel: 'full',
    });
    expect([...db.objectStoreNames]).toContain('searchIndex');
    await app.close();
  });

  it('Motikord: clips, brand kit and export jobs read back', async () => {
    await buildOriginal(MOTIKORD, async (db) => {
      await db.put('clips', { id: 'c1', updatedAt: 5 });
      await db.put('brandKit', { colours: [] }, 'brand');
      await db.put('exportJobs', { id: 'j1', status: 'running', startedAt: 1 });
    });
    const app = createDB<any>(MOTIKORD as never);
    const db = await app.get();
    expect(db.version).toBe(1);
    expect(await db.getAllFromIndex('clips', 'updatedAt')).toEqual([{ id: 'c1', updatedAt: 5 }]);
    expect(await db.get('brandKit', 'brand')).toEqual({ colours: [] });
    expect(await db.getAllFromIndex('exportJobs', 'status', 'running')).toHaveLength(1);
    await app.close();
  });
});

describe('createDB', () => {
  afterEach(async () => {
    await drop('motikord');
  });

  it('reuses one connection until closed', async () => {
    const app = createDB<any>(MOTIKORD as never);
    const a = app.get();
    expect(app.get()).toBe(a);
    await app.close();
    expect(app.get()).not.toBe(a);
    await app.close();
  });

  it('puts, gets and clears the folder handle', async () => {
    const app = createDB<any>(MOTIKORD as never);
    const folder = folderHandle(app.get);
    const handle = { name: 'out' } as unknown as FileSystemDirectoryHandle;
    expect(await folder.get()).toBeUndefined();
    await folder.put(handle);
    expect(await folder.get()).toEqual(handle);
    await folder.clear();
    expect(await folder.get()).toBeUndefined();
    await app.close();
  });
});
