import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB, getDB, listMeetings, listRecordingParts, putRecordingPart } from './db';
import { listItems, listPeople, listVectors, putVectors } from './memory/store';
import { SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE, seedSample } from './memory/sample';
import { buildExport, exportInfo, exportName, importMove, parseMove, previewMove } from './move';
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
    const text = await (await buildExport()).text();
    expect(text).not.toContain('gsk_test');
    expect(text).not.toContain('penv_test_token');
    expect(text).not.toContain('conn_test');
    expect(parseMove(text)!.settings).not.toHaveProperty('penvApp');
    expect(parseMove(text)!.settings.memory).toEqual(s.memory);
  });

  it('round-trips everything into an empty Rekord', async () => {
    const text = await (await buildExport()).text();
    await fresh();
    const file = parseMove(text)!;
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
    const file = parseMove(await (await buildExport()).text())!;
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

  it('rejects a file that is not a Rekord file', () => {
    expect(parseMove('{"format":"other"}')).toBeUndefined();
    expect(parseMove('not json')).toBeUndefined();
  });
});
