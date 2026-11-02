import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATCHUP_SOURCES, micBlockedReply, needsTabGrant } from '../capture';
import { beginCatchup, closeDB, endCatchupPart, getMeeting, listSegments, putMeeting, saveTypedPart } from '../db';
import type { CalendarEvent, CatchupStart } from '../types';
import {
  addPart, cappedPartMs, clockMs, isPaused, limitState, newCatchupMeeting, pauseClock, pickedTimes, resumeClock, startClock,
  TELL_LIMIT_MS, TELL_WARN_MS, typedPart, TYPED_MS_PER_WORD,
} from './session';

const MIN = 60_000;
const event: CalendarEvent = {
  id: 'ev1', title: 'Q4 planning with Northwind', start: 1_000_000, end: 1_000_000 + 4 * 60 * MIN,
  attendees: [{ email: 'sarah@example.com', name: 'Sarah' }, { email: 'me@example.com', self: true }],
};
const picked = { kind: 'event', event } as const;
let n = 0;
const newId = () => `id${++n}`;

describe('start with no tab', () => {
  it('asks for the microphone only, so no tab grant is needed', () => {
    expect(CATCHUP_SOURCES).toEqual({ mic: true, tab: false });
    expect(needsTabGrant({ tabOn: CATCHUP_SOURCES.tab, tabUrl: undefined })).toBe(false);
  });
  it('a blocked mic replies with the V41States copy and a flag for the permission tab', () => {
    expect(micBlockedReply()).toEqual({ ok: false, error: 'Rekord can’t use your microphone', micBlocked: true });
  });
  it('creates the meeting with the picked meeting’s times, source catchup and told', () => {
    const m = newCatchupMeeting('m1', picked, 'en', 5_000_000_000);
    expect(m).toMatchObject({ id: 'm1', title: event.title, startedAt: event.start, endedAt: event.end, event, source: 'catchup', status: 'recording' });
    expect(m.told).toEqual({ at: 5_000_000_000, ms: 0, parts: [] });
    expect(m.tabUrl).toBeUndefined();
  });
  it('maps the Something else form to local times', () => {
    const t = pickedTimes({ kind: 'form', form: { name: ' Hiring sync ', date: '2026-10-29', start: '15:00', lengthMin: 30, attendees: [] } });
    const start = new Date(2026, 9, 29, 15, 0).getTime();
    expect(t).toEqual({ title: 'Hiring sync', startedAt: start, endedAt: start + 30 * MIN });
  });
});

describe('pause and the clock', () => {
  it('counts telling time only', () => {
    let c = startClock(0);
    expect(clockMs(c, 60_000)).toBe(60_000);
    c = pauseClock(c, 60_000);
    expect(isPaused(c)).toBe(true);
    expect(clockMs(c, 600_000)).toBe(60_000);
    c = resumeClock(c, 600_000);
    expect(clockMs(c, 615_000)).toBe(75_000);
    expect(pauseClock(pauseClock(c, 620_000), 999_999)).toEqual(pauseClock(c, 620_000));
  });
  it('continues after the earlier parts (Add more)', () => {
    expect(clockMs(startClock(1_000, 300_000), 11_000)).toBe(310_000);
  });
});

describe('the limit', () => {
  it('warns at 55:00 and stops at 60:00', () => {
    expect(limitState(TELL_WARN_MS - 1)).toBe('ok');
    expect(limitState(TELL_WARN_MS)).toBe('warn');
    expect(limitState(TELL_LIMIT_MS)).toBe('stop');
  });
  it('never lets the whole telling pass 60 minutes', () => {
    const c = startClock(0, 50 * MIN);
    expect(cappedPartMs(c, 15 * MIN)).toBe(10 * MIN);
    expect(cappedPartMs(c, 5 * MIN)).toBe(5 * MIN);
  });
});

describe('parts', () => {
  it('Add more appends a part and keeps a voice answer with its atMs', () => {
    let told = addPart({ at: 1, ms: 0, parts: [] }, { at: 1, ms: 300_000, kind: 'voice' });
    told = addPart(told, { at: 2, ms: 60_000, kind: 'voice' }, { questionId: 'q1', atMs: 300_000 });
    expect(told).toEqual({ at: 1, ms: 360_000, parts: [{ at: 1, ms: 300_000, kind: 'voice' }, { at: 2, ms: 60_000, kind: 'voice' }], answers: [{ questionId: 'q1', atMs: 300_000 }] });
    expect(told.typed).toBeUndefined();
  });
  it('typed text becomes you segments of one typed part after the telling so far', () => {
    const t = typedPart('m1', 'Sarah owns the plan.\n\n  Tom   sets up access by Friday. ', 1_000, 9, newId)!;
    expect(t.part).toEqual({ at: 9, ms: 10 * TYPED_MS_PER_WORD, kind: 'typed' });
    expect(t.segments.map((s) => [s.speaker, s.startMs, s.endMs, s.text])).toEqual([
      ['you', 1_000, 1_000 + 4 * TYPED_MS_PER_WORD, 'Sarah owns the plan.'],
      ['you', 1_000 + 4 * TYPED_MS_PER_WORD, 1_000 + 10 * TYPED_MS_PER_WORD, 'Tom sets up access by Friday.'],
    ]);
    expect(new Set(t.segments.map((s) => s.chunkId)).size).toBe(1);
    expect(typedPart('m1', ' \n ', 0, 0, newId)).toBeNull();
  });
});

describe('stored catch-up', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });
  const start: CatchupStart = { meetingId: 'm1', picked };

  it('a telling then Add more: one meeting, parts in order, segments continue', async () => {
    expect(await beginCatchup(start, 'en', 5_000)).toBe(0);
    await endCatchupPart('m1', { at: 5_000, ms: 300_000, kind: 'voice' });
    let m = await getMeeting('m1');
    expect(m).toMatchObject({ status: 'processing', startedAt: event.start, endedAt: event.end, source: 'catchup' });
    expect(await beginCatchup({ ...start, append: true }, 'en', 900_000)).toBe(300_000);
    expect((await getMeeting('m1'))?.status).toBe('recording');
    await endCatchupPart('m1', { at: 900_000, ms: 60_000, kind: 'voice' }, { questionId: 'q2', atMs: 300_000 });
    m = await getMeeting('m1');
    expect(m?.told).toMatchObject({ at: 5_000, ms: 360_000, answers: [{ questionId: 'q2', atMs: 300_000 }] });
    expect(m?.told?.parts).toHaveLength(2);
    expect(m?.endedAt).toBe(event.end);
  });

  it('refuses a second new catch-up on the same id and Add more on a recording', async () => {
    await beginCatchup(start, 'en', 1);
    await expect(beginCatchup(start, 'en', 2)).rejects.toThrow();
    await putMeeting({ id: 'tab1', title: 'Tab', startedAt: 1, status: 'done', language: 'en' });
    await expect(beginCatchup({ meetingId: 'tab1', picked, append: true }, 'en', 2)).rejects.toThrow();
  });

  it('typed parts are saved as you segments after the voice telling', async () => {
    await beginCatchup(start, 'en', 1);
    await endCatchupPart('m1', { at: 1, ms: 120_000, kind: 'voice' });
    expect(await saveTypedPart({ ...start, append: true }, 'Priya decided to ship.', 'en', 2, newId)).toBe(true);
    const m = await getMeeting('m1');
    expect(m?.told).toMatchObject({ ms: 120_000 + 4 * TYPED_MS_PER_WORD, typed: true });
    expect(m?.told?.parts.map((p) => p.kind)).toEqual(['voice', 'typed']);
    const segs = await listSegments('m1');
    expect(segs.map((s) => [s.speaker, s.startMs])).toEqual([['you', 120_000]]);
  });

  it('typing first creates the meeting; empty text saves nothing', async () => {
    expect(await saveTypedPart({ meetingId: 'm2', picked }, '', 'en', 1, newId)).toBe(false);
    expect(await getMeeting('m2')).toBeUndefined();
    expect(await saveTypedPart({ meetingId: 'm2', picked }, 'We agreed on Q4.', 'en', 1, newId)).toBe(true);
    expect(await getMeeting('m2')).toMatchObject({ source: 'catchup', status: 'processing', told: { typed: true, parts: [{ kind: 'typed' }] } });
  });
});
