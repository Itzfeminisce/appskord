import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB, getDB, listMeetings, listRecordingParts, putRecordingPart } from './db';
import { addTombstones, listItems, listPeople, listVectors, putVectors } from './memory/store';
import { SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE, seedSample } from './memory/sample';
import { buildExport, exportInfo, exportName, fillMissing, importMove, parseMove, previewMove } from './move';
import { getSettings, updateSettings } from './settings';

async function fresh() {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  await browser.storage.local.clear();
  await browser.storage.session.clear();
}

describe('move to a new computer', () => {
  beforeEach(async () => {
    await fresh();
    await seedSample(await getDB());
    await putVectors([{ id: 'v1', meetingId: SAMPLE_MEETINGS[0]!.id, atMs: 0, endMs: 30_000, text: 'hello', v: new Int8Array([1, -2, 3]), scale: 0.5 }]);
    await putRecordingPart({ id: 'r1', meetingId: SAMPLE_MEETINGS[0]!.id, seq: 0, mimeType: 'audio/webm', blob: new Blob([new Uint8Array([7, 8, 9])]) });
  });

  it('describes the file and names it by date', async () => {
    expect(await exportInfo()).toMatchObject({ meetings: 24, people: 12, items: 74, audio: true });
    expect(exportName(new Date(2026, 9, 30).getTime())).toBe('rekord-2026-10-30.rekord');
  });

  it('keeps no key or token in the file', async () => {
    await browser.storage.session.set({ GROQ_API_KEY: 'gsk_test', penvToken: 'penv_test_token' });
    const s = await getSettings();
    await updateSettings({ keySource: 'penv-app', penvApp: { connectionId: 'conn_test', org: 'o', project: 'p', env: 'e', keys: ['GROQ_API_KEY'] } });
    const blob = await buildExport();
    const text = await blob.text();
    expect(text).not.toContain('gsk_test');
    expect(text).not.toContain('penv_test_token');
    expect(text).not.toContain('conn_test');
    expect((await parseMove(blob))!.settings).not.toHaveProperty('penvApp');
    expect((await parseMove(blob))!.settings.memory).toEqual(s.memory);
  });

  it('round-trips everything into an empty Rekord', async () => {
    const blob = await buildExport();
    await fresh();
    const file = (await parseMove(blob))!;
    expect(await previewMove(file)).toEqual({ meetings: 24, people: 12, already: 0 });
    expect(await importMove(file)).toEqual({ meetings: 24 });
    expect(await listMeetings()).toHaveLength(24);
    expect(await listPeople()).toHaveLength(12);
    expect(await listItems()).toHaveLength(74);
    const [v] = await listVectors();
    expect(Array.from(v!.v)).toEqual([1, -2, 3]);
    const [part] = await listRecordingParts(SAMPLE_MEETINGS[0]!.id);
    expect(Array.from(new Uint8Array(await part!.blob.arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it('keeps duplicates once and this computer’s copy wins', async () => {
    const file = (await parseMove(await buildExport()))!;
    file.meetings = file.meetings.map((m) => ({ ...m, title: 'From the other computer' }));
    file.meetings.push(SAMPLE_ONE_ON_ONE);
    expect(await previewMove(file)).toMatchObject({ meetings: 25, already: 24 });
    expect(await importMove(file)).toEqual({ meetings: 1 });
    const meetings = await listMeetings();
    expect(meetings).toHaveLength(25);
    expect(meetings.filter((m) => m.title === 'From the other computer')).toHaveLength(0);
    expect(await listItems()).toHaveLength(74);
    expect(await listVectors()).toHaveLength(1);
  });

  it('rejects a file that is not a Rekord file', async () => {
    expect(await parseMove(new Blob(['{"format":"other"}']))).toBeUndefined();
    expect(await parseMove(new Blob(['not json']))).toBeUndefined();
    const whole = await buildExport();
    expect(await parseMove(whole.slice(0, whole.size - 1))).toBeUndefined();
  });

  it('keeps audio as a Blob piece after the JSON header', async () => {
    const blob = await buildExport();
    const head = await blob.slice(0, 25).text();
    expect(head.startsWith('REKORD-MOVE\n')).toBe(true);
    expect(Array.from(new Uint8Array(await blob.slice(blob.size - 3).arrayBuffer()))).toEqual([7, 8, 9]);
  });

  it('keeps this computer’s settings and skips redacted or forgotten items', async () => {
    const blob = await buildExport();
    const local = await getSettings();
    await updateSettings({ memory: { ...local.memory, folder: !local.memory.folder } });
    const file = (await parseMove(blob))!;
    const [item] = await listItems();
    await fresh();
    await updateSettings({ memory: { ...local.memory, folder: !local.memory.folder } });
    await addTombstones([item!.id, 'p-sarah']);
    await importMove(file);
    expect((await getSettings()).memory.folder).toBe(!local.memory.folder);
    expect(await listItems()).toHaveLength(73);
    expect((await listPeople()).find((p) => p.id === 'p-sarah')).toBeUndefined();
  });

  it('fills only missing settings keys', () => {
    expect(fillMissing({ a: 1, n: { x: 1 } }, { a: 2, b: 3, n: { x: 2, y: 4 } })).toEqual({ a: 1, b: 3, n: { x: 1, y: 4 } });
  });
});
