import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDB, putMeeting, putSegment } from '../db';
import { saveKeys } from '../penv';
import { getSettings } from '../settings';
import { BACKFILL_ALARM, BACKFILL_KEY, MAX_RATE_LIMITS, readBackfill, requestBackfill, runBackfill, type BackfillProgress } from './backfill';
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

  it('gives up on a meeting after repeated rate limits and moves on', async () => {
    await requestBackfill();
    let t = 0;
    for (let i = 0; i < MAX_RATE_LIMITS; i++) {
      t += 100_000;
      await runBackfill({ fetchFn: async () => limit(), now: () => t });
    }
    let p = (await readBackfill())!;
    expect(p.meetings.map((m) => m.status)).toEqual(['failed', 'waiting', 'waiting']);
    expect(p).toMatchObject({ done: 1, failed: 1, total: 3 });
    await runBackfill({ fetchFn: vi.fn().mockImplementation(answer), now: () => t + 100_000 });
    p = (await readBackfill())!;
    expect(p.meetings.map((m) => m.status)).toEqual(['failed', 'done', 'done']);
    expect((await getSettings()).memory.backfill).toBe('done');
  });

  it('stops on a key problem, keeps the meetings to do, and resumes when asked again', async () => {
    await requestBackfill();
    const bad = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }));
    await runBackfill({ fetchFn: bad });
    expect(bad).toHaveBeenCalledTimes(1);
    let p = (await readBackfill())!;
    expect(p).toMatchObject({ error: 'key', done: 0, total: 3 });
    expect(p.meetings.every((m) => m.status === 'waiting')).toBe(true);
    expect((await getSettings()).memory.backfill).toBe('running');

    await requestBackfill();
    expect((await readBackfill())?.error).toBeUndefined();
    await runBackfill({ fetchFn: vi.fn().mockImplementation(answer) });
    p = (await readBackfill())!;
    expect(p).toMatchObject({ done: 3, total: 3 });
  });

  it('does nothing when asked again while it is running', async () => {
    await requestBackfill();
    await fakeBrowser.storage.local.set({ [BACKFILL_KEY]: { ...(await readBackfill())!, meetings: [{ id: 'a', title: 'A', status: 'done', found: 1 }] } });
    await fakeBrowser.alarms.clear(BACKFILL_ALARM);
    const again = await requestBackfill();
    expect(again.meetings).toEqual([{ id: 'a', title: 'A', status: 'done', found: 1 }]);
    expect(await fakeBrowser.alarms.get(BACKFILL_ALARM)).toBeUndefined();
  });
});
