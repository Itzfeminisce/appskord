import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDB, putMeeting, putSegment } from '../db';
import { saveKeys } from '../penv';
import { getSettings } from '../settings';
import { BACKFILL_ALARM, BACKFILL_KEY, readBackfill, requestBackfill, runBackfill, type BackfillProgress } from './backfill';
import { listLedger } from './store';

const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
const limit = (headers?: Record<string, string>) =>
  new Response(JSON.stringify({ error: { message: 'Rate limit reached', type: 'requests' } }), { status: 429, headers });
const SAID: Record<string, string> = { a: 'Lunch moves to Thursday', b: 'Budget grows twenty percent', c: 'Hiring pauses until spring' };
const found = (quote: string) => reply({ items: [{ kind: 'decision', text: quote, quote, speaker: 'You', atMs: 0 }] });
const answer = async (_u: string, init: RequestInit) => found(Object.values(SAID).find((t) => String(init.body).includes(t))!);

beforeEach(async () => {
  fakeBrowser.reset();
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
  for (const [id, startedAt] of [['a', 1], ['b', 2], ['c', 3]] as const) {
    await putMeeting({ id, title: `Meeting ${id}`, startedAt, status: 'done', language: 'en' });
    await putSegment({ id: `s${id}`, meetingId: id, speaker: 'you', startMs: 0, endMs: 4000, text: SAID[id]!, chunkId: 'c' });
  }
  await putMeeting({ id: 'silent', title: 'No speech', startedAt: 4, status: 'done', language: 'en' });
});

describe('backfill', () => {
  it('queues earlier meetings, wakes the background, and builds memory one meeting at a time', async () => {
    const start = await requestBackfill();
    expect(start).toMatchObject({ done: 0, total: 3 });
    expect(start.meetings.map((m) => [m.id, m.status])).toEqual([['a', 'waiting'], ['b', 'waiting'], ['c', 'waiting']]);
    expect((await getSettings()).memory.backfill).toBe('running');
    expect(await fakeBrowser.alarms.get(BACKFILL_ALARM)).toBeDefined();

    const f = vi.fn().mockImplementation(answer);
    await runBackfill({ fetchFn: f });
    const p = (await readBackfill())!;
    expect(p).toMatchObject({ done: 3, total: 3, totals: { promises: 0, decisions: 3, people: 0 } });
    expect(p.meetings.every((m) => m.status === 'done' && m.found === 1)).toBe(true);
    expect((await getSettings()).memory.backfill).toBe('done');
    expect(await fakeBrowser.alarms.get(BACKFILL_ALARM)).toBeUndefined();
    expect(await listLedger()).toHaveLength(3);
  });

  it('pauses on a rate limit until the time the provider gives, then carries on by itself', async () => {
    await requestBackfill();
    const now = 1_000_000;
    const f = vi.fn()
      .mockResolvedValueOnce(found(SAID.a!))
      .mockResolvedValueOnce(limit({ 'retry-after': '120' }));
    await runBackfill({ fetchFn: f, now: () => now });
    let p = (await readBackfill())!;
    expect(p).toMatchObject({ done: 1, total: 3, resumeAt: now + 120_000 });
    expect(p.meetings.map((m) => m.status)).toEqual(['done', 'waiting', 'waiting']);
    expect((await fakeBrowser.alarms.get(BACKFILL_ALARM))?.scheduledTime).toBe(now + 120_000);

    // An early wake (a restart) only re-arms the alarm.
    const early = vi.fn();
    await runBackfill({ fetchFn: early, now: () => now + 60_000 });
    expect(early).not.toHaveBeenCalled();

    const later = vi.fn().mockImplementation(answer);
    await runBackfill({ fetchFn: later, now: () => now + 121_000 });
    p = (await readBackfill())!;
    expect(p).toMatchObject({ done: 3, total: 3 });
    expect(p.resumeAt).toBeUndefined();
    expect(later).toHaveBeenCalledTimes(2);
  });

  it('waits a minute when the provider gives no time', async () => {
    await requestBackfill();
    await runBackfill({ fetchFn: async () => limit(), now: () => 5000 });
    expect((await readBackfill())?.resumeAt).toBe(65_000);
  });

  it('does nothing unless the person asked for it', async () => {
    await fakeBrowser.storage.local.set({ [BACKFILL_KEY]: { meetings: [{ id: 'a', title: 'A', status: 'waiting' }], done: 0, total: 1 } satisfies BackfillProgress });
    const f = vi.fn();
    await runBackfill({ fetchFn: f });
    expect(f).not.toHaveBeenCalled();
  });
});
