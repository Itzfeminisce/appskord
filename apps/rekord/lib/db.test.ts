import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeDB, deleteMeeting, getDB, getMeeting, listChunks, listMarkers, listMeetings, listNotes, listSegments,
  pendingChunks, putChunk, putMarker, putMeeting, putNote, putSegment,
  DB_VERSION, deleteRecording, getRecordingMeta, listAsks, listRecordingParts, putAsk, putRecordingMeta, putRecordingPart,
} from './db';
import { openDB } from 'idb';
import type { MemoryItem } from './memory/types';
import type { Chunk, Meeting } from './types';

const meeting = (id: string, startedAt: number): Meeting => ({ id, title: id, startedAt, status: 'done', language: 'en' });
const chunk = (id: string, meetingId: string, startMs: number, status: Chunk['status']): Chunk => ({
  id, meetingId, speaker: 'you', startMs, endMs: startMs + 10_000, mimeType: 'audio/webm', status, attempts: 0,
});

describe('db', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  it('lists meetings newest first', async () => {
    await putMeeting(meeting('a', 1));
    await putMeeting(meeting('b', 2));
    expect((await listMeetings()).map((m) => m.id)).toEqual(['b', 'a']);
    expect((await getMeeting('a'))?.title).toBe('a');
  });

  it('lists children by meeting, sorted by time', async () => {
    await putMeeting(meeting('m', 1));
    await putSegment({ id: 's2', meetingId: 'm', speaker: 'you', startMs: 20, endMs: 30, text: 'b', chunkId: 'c' });
    await putSegment({ id: 's1', meetingId: 'm', speaker: 'others', startMs: 0, endMs: 10, text: 'a', chunkId: 'c' });
    await putSegment({ id: 'x', meetingId: 'other', speaker: 'you', startMs: 0, endMs: 10, text: 'x', chunkId: 'c' });
    expect((await listSegments('m')).map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('returns pending chunks, optionally per meeting', async () => {
    await putChunk(chunk('c2', 'm', 10, 'pending'));
    await putChunk(chunk('c1', 'm', 0, 'pending'));
    await putChunk(chunk('c3', 'm', 20, 'done'));
    await putChunk(chunk('c4', 'n', 0, 'pending'));
    expect((await pendingChunks('m')).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(await pendingChunks()).toHaveLength(3);
  });

  it('orders pending chunks across meetings by absolute time', async () => {
    await putMeeting(meeting('early', 1000));
    await putMeeting(meeting('late', 5000));
    await putChunk(chunk('l0', 'late', 0, 'pending'));
    await putChunk(chunk('e2', 'early', 3000, 'pending'));
    await putChunk(chunk('e0', 'early', 0, 'pending'));
    expect((await pendingChunks()).map((c) => c.id)).toEqual(['e0', 'e2', 'l0']);
  });

  it('cascades meeting deletes', async () => {
    await putMeeting(meeting('m', 1));
    await putMeeting(meeting('keep', 2));
    await putNote({ id: 'n', meetingId: 'm', atMs: 0, text: 'hi', createdAt: 1 });
    await putMarker({ id: 'k', meetingId: 'm', atMs: 0, kind: 'decision' });
    await putChunk(chunk('c', 'm', 0, 'pending'));
    await putChunk(chunk('c-keep', 'keep', 0, 'pending'));
    await deleteMeeting('m');
    expect(await getMeeting('m')).toBeUndefined();
    expect(await listNotes('m')).toEqual([]);
    expect(await listMarkers('m')).toEqual([]);
    expect(await listChunks('m')).toEqual([]);
    expect(await listChunks('keep')).toHaveLength(1);
  });
});

describe('db v2', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  it('migrates a v1 database and keeps its data', async () => {
    const v1 = await openDB('rekord', 1, {
      upgrade(db) {
        db.createObjectStore('meetings', { keyPath: 'id' });
        for (const n of ['segments', 'notes', 'markers']) db.createObjectStore(n, { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
        const c = db.createObjectStore('chunks', { keyPath: 'id' });
        c.createIndex('meetingId', 'meetingId');
        c.createIndex('status', 'status');
      },
    });
    await v1.put('meetings', meeting('old', 5));
    await v1.put('segments', { id: 's', meetingId: 'old', speaker: 'you', startMs: 0, endMs: 1, text: 'hi', chunkId: 'c' });
    await v1.put('chunks', chunk('c', 'old', 0, 'pending'));
    v1.close();

    expect(DB_VERSION).toBeGreaterThan(1);
    expect(await getMeeting('old')).toEqual(meeting('old', 5));
    expect(await listSegments('old')).toHaveLength(1);
    expect(await pendingChunks()).toHaveLength(1);
    await putAsk({ id: 'a', meetingId: 'old', createdAt: 1, question: 'q?' });
    expect(await listAsks('old')).toHaveLength(1);
  });

  it('stores asks, recording parts in seq order and recording meta', async () => {
    await putAsk({ id: 'a2', meetingId: 'm', createdAt: 20, question: 'second' });
    await putAsk({ id: 'a1', meetingId: 'm', createdAt: 10, question: 'first', answer: 'x', citations: [1000] });
    await putAsk({ id: 'z', meetingId: 'other', createdAt: 5, question: 'nope' });
    expect((await listAsks('m')).map((a) => a.id)).toEqual(['a1', 'a2']);

    const blob = new Blob(['x']);
    for (const seq of [2, 0, 1]) await putRecordingPart({ id: `p${seq}`, meetingId: 'm', seq, blob, mimeType: 'audio/webm' });
    await putRecordingPart({ id: 'q', meetingId: 'other', seq: 0, blob, mimeType: 'audio/webm' });
    expect((await listRecordingParts('m')).map((p) => p.seq)).toEqual([0, 1, 2]);

    await putRecordingMeta({ meetingId: 'm', pauses: [{ atMs: 5000, durationMs: 2000 }] });
    expect((await getRecordingMeta('m'))?.pauses).toHaveLength(1);

    await deleteRecording('m');
    expect(await listRecordingParts('m')).toEqual([]);
    expect(await getRecordingMeta('m')).toBeUndefined();
    expect(await listAsks('m')).toHaveLength(2);
    expect(await listRecordingParts('other')).toHaveLength(1);
  });

  it('deleteMeeting also clears asks and recordings', async () => {
    await putMeeting(meeting('m', 1));
    await putAsk({ id: 'a', meetingId: 'm', createdAt: 1, question: 'q' });
    await putRecordingPart({ id: 'p', meetingId: 'm', seq: 0, blob: new Blob(['x']), mimeType: 'audio/webm' });
    await putRecordingMeta({ meetingId: 'm', pauses: [] });
    await putAsk({ id: 'k', meetingId: 'keep', createdAt: 1, question: 'q' });
    await deleteMeeting('m');
    expect(await listAsks('m')).toEqual([]);
    expect(await listRecordingParts('m')).toEqual([]);
    expect(await getRecordingMeta('m')).toBeUndefined();
    expect(await listAsks('keep')).toHaveLength(1);
  });
});

describe('db v3', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  it('upgrades a v2 database, keeps old meetings and adds the memory stores', async () => {
    const v2 = await openDB('rekord', 2, {
      upgrade(db) {
        db.createObjectStore('meetings', { keyPath: 'id' });
        for (const n of ['segments', 'notes', 'markers', 'asks', 'recordings']) db.createObjectStore(n, { keyPath: 'id' }).createIndex('meetingId', 'meetingId');
        const c = db.createObjectStore('chunks', { keyPath: 'id' });
        c.createIndex('meetingId', 'meetingId');
        c.createIndex('status', 'status');
        db.createObjectStore('recordingMeta', { keyPath: 'meetingId' });
      },
    });
    await v2.put('meetings', meeting('old', 5));
    await v2.put('asks', { id: 'a', meetingId: 'old', createdAt: 1, question: 'q?' });
    v2.close();

    expect(DB_VERSION).toBe(3);
    expect(await getMeeting('old')).toEqual(meeting('old', 5));
    expect(await listAsks('old')).toHaveLength(1);
    const db = await getDB();
    for (const store of ['people', 'items', 'vectors', 'ledger', 'agendas'] as const) expect(db.objectStoreNames.contains(store)).toBe(true);
    expect([...db.transaction('items').store.indexNames].sort()).toEqual(['kind', 'meetingId', 'personId', 'status']);
  });

  it('deleteMeeting also removes its memory items, vectors, ledger rows and agenda', async () => {
    const db = await getDB();
    const quote = { speaker: 'Alex', text: 'x', meetingId: 'm', atMs: 0 };
    const item = (id: string, meetingId: string) => ({
      id, kind: 'promise' as const, status: 'open' as const, text: id, quote, meetingId, personIds: ['p'], history: [], createdAt: 0, updatedAt: 0,
    });
    await putMeeting({ ...meeting('m', 1), event: { id: 'evt', title: 'm', start: 0, end: 1, attendees: [] } });
    await db.put('items', item('i', 'm'));
    await db.put('items', item('keep', 'other'));
    await db.put('vectors', { id: 'v', meetingId: 'm', atMs: 0, endMs: 1, text: 'x', v: new Int8Array(2), scale: 1 });
    await db.put('ledger', { id: 'l', meetingId: 'm', service: 'groq', what: 'Audio for transcription', count: 1, firstAt: 0, lastAt: 0 });
    await db.put('agendas', { meetingKey: 'evt', items: [], totalMinutes: 30 });
    await db.put('agendas', { meetingKey: 'm', items: [], totalMinutes: 30 });
    await deleteMeeting('m');
    expect(await db.get('items', 'i')).toBeUndefined();
    expect(await db.get('items', 'keep')).toBeDefined();
    expect(await db.get('vectors', 'v')).toBeUndefined();
    expect(await db.get('ledger', 'l')).toBeUndefined();
    expect(await db.getAll('agendas')).toEqual([]);
  });

  it('deleteMeeting drops the meeting from people and reopens decisions that pointed at its items', async () => {
    const db = await getDB();
    const base: Omit<MemoryItem, 'id' | 'status' | 'meetingId'> = { kind: 'decision', text: 't', quote: { speaker: 'A', text: 't', meetingId: 'm', atMs: 0 }, personIds: [], history: [], createdAt: 0, updatedAt: 0 };
    await db.put('people', { id: 'p', name: 'P', aliases: [], meetingIds: ['m', 'k'], createdAt: 0, updatedAt: 0 });
    await db.put('items', { ...base, id: 'new', status: 'open', meetingId: 'm', replacesId: 'old' });
    await db.put('items', { ...base, id: 'old', status: 'replaced', meetingId: 'k', replacedById: 'new' });
    await db.put('items', { ...base, id: 'prev', status: 'open', meetingId: 'k', replacesId: 'gone' });
    await deleteMeeting('m');
    expect((await db.get('people', 'p'))?.meetingIds).toEqual(['k']);
    const old = await db.get('items', 'old');
    expect(old).toMatchObject({ status: 'open' });
    expect(old?.replacedById).toBeUndefined();
    expect(await db.get('items', 'new')).toBeUndefined();
  });
});
