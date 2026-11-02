import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDB } from './db';
import { mergeCall, record } from './ledger';
import { ledgerForMeeting, listLedger } from './memory/store';

describe('mergeCall', () => {
  const call = { meetingId: 'm', service: 'groq' as const, what: 'Audio for transcription' };
  it('starts a row, then adds to it', () => {
    const first = mergeCall([], call, 10, () => 'id1');
    expect(first).toEqual({ id: 'id1', meetingId: 'm', service: 'groq', what: 'Audio for transcription', count: 1, firstAt: 10, lastAt: 10 });
    expect(mergeCall([first], call, 30, () => 'x')).toMatchObject({ id: 'id1', count: 2, firstAt: 10, lastAt: 30 });
  });
  it('keeps different meetings, services and whats apart', () => {
    const first = mergeCall([], call, 10, () => 'id1');
    expect(mergeCall([first], { ...call, meetingId: 'n' }, 20, () => 'id2').id).toBe('id2');
    expect(mergeCall([first], { ...call, service: 'openai' }, 20, () => 'id2').id).toBe('id2');
    expect(mergeCall([first], { ...call, what: 'Clash checks' }, 20, () => 'id2').id).toBe('id2');
  });
  it('keeps one off the record row per span, with its own start and end', async () => {
    const off = { meetingId: 'm', service: 'off-record' as const, what: 'Off the record', span: true };
    const a = mergeCall([], off, 0, () => 'a');
    const a2 = mergeCall([a], off, 120_000, () => 'x');
    expect(a2).toMatchObject({ id: 'a', count: 2, firstAt: 0, lastAt: 120_000 });
    const b = mergeCall([a2], off, 600_000, () => 'b');
    expect(b).toMatchObject({ id: 'b', count: 1, firstAt: 600_000 });
    const b2 = mergeCall([a2, b], off, 900_000, () => 'y');
    expect(b2).toMatchObject({ id: 'b', count: 2, firstAt: 600_000, lastAt: 900_000 });
    const { meetingRows } = await import('../entrypoints/sidepanel/screens/v4/ledgerView');
    expect(meetingRows([a2, b2]).map((r) => r.detail)).toEqual(['2 min · nothing sent', '5 min · nothing sent']);
  });
});

describe('record', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });

  it('merges parallel calls of one meeting into one row', async () => {
    await Promise.all([1, 2, 3].map((n) => record({ meetingId: 'm', service: 'groq', what: 'Audio for transcription', at: n * 1000 })));
    await record({ service: 'google-calendar', what: 'Read this event', at: 5 });
    await record({ service: 'google-calendar', what: 'Read this event', at: 6 });
    expect(await ledgerForMeeting('m')).toEqual([expect.objectContaining({ count: 3, firstAt: 1000, lastAt: 3000 })]);
    expect((await listLedger()).find((r) => !r.meetingId)).toMatchObject({ count: 2, firstAt: 5, lastAt: 6 });
  });

  it('keeps one row when another context writes at the same time', async () => {
    const { getDB } = await import('./db');
    await Promise.all([record({ meetingId: 'm', service: 'groq', what: 'Clash checks', at: 1 }), record({ meetingId: 'm', service: 'groq', what: 'Clash checks', at: 2 })]);
    expect((await (await getDB()).getAll('ledger'))).toHaveLength(1);
  });
});
