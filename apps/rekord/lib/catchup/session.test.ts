import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATCHUP_SOURCES, micBlockedReply, needsTabGrant } from '../capture';
import {
  addCatchupPart, beginCatchup, closeDB, deleteTellingAudio, endCatchupPart, getMeeting, listRecordingParts, listSegments, listTellingAudio, putMeeting,
  putRecordingPart, saveTypedPart, tellingAudioAt, undoCatchup,
} from '../db';
import { ContinuousRecording, type SliceRecorder } from '../audio/recording';
import type { CalendarEvent, CatchupStart } from '../types';
import {
  addPart, cappedPartMs, clockMs, isPaused, limitState, locateTelling, newCatchupMeeting, partMs, pauseClock, pickedTimes, resumeClock, startClock,
  tellSeqBase,
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
  it('keeps form attendees where the app reads a meeting’s attendees (event.attendees)', () => {
    const form = { name: 'Hiring sync', date: '2026-10-29', start: '15:00', lengthMin: 30, attendees: [{ name: ' Sam ' }, { email: 'leo@example.com' }, {}] };
    const m = newCatchupMeeting('m9', { kind: 'form', form }, 'en', 1);
    expect(m.event).toEqual({ id: 'form:m9', title: 'Hiring sync', start: m.startedAt, end: m.endedAt, attendees: [{ name: 'Sam', email: '' }, { email: 'leo@example.com' }] });
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
  it('applies to each part, so Add more can follow a 60-minute telling', () => {
    const c = startClock(0, 60 * MIN);
    expect(limitState(partMs(c, 5 * MIN))).toBe('ok');
    expect(limitState(partMs(c, 55 * MIN))).toBe('warn');
    expect(cappedPartMs(c, 65 * MIN)).toBe(60 * MIN);
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
    expect(await beginCatchup(start, 'en', 5_000)).toEqual({ offsetMs: 0, part: 0 });
    await endCatchupPart('m1', { at: 5_000, ms: 300_000, kind: 'voice' });
    let m = await getMeeting('m1');
    expect(m).toMatchObject({ status: 'processing', startedAt: event.start, endedAt: event.end, source: 'catchup' });
    expect(await beginCatchup({ ...start, append: true }, 'en', 900_000)).toEqual({ offsetMs: 300_000, part: 1, status: 'processing' });
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

  it('Add more after a full 60-minute telling', async () => {
    await beginCatchup(start, 'en', 1);
    await endCatchupPart('m1', { at: 1, ms: TELL_LIMIT_MS, kind: 'voice' });
    expect(await beginCatchup({ ...start, append: true }, 'en', 2)).toEqual({ offsetMs: TELL_LIMIT_MS, part: 1, status: 'processing' });
  });

  it('a failed Add more puts back the status it had; a failed first telling leaves no meeting', async () => {
    await beginCatchup(start, 'en', 1);
    await endCatchupPart('m1', { at: 1, ms: 60_000, kind: 'voice' });
    await putMeeting({ ...(await getMeeting('m1'))!, status: 'done' });
    const { status } = await beginCatchup({ ...start, append: true }, 'en', 2);
    await undoCatchup({ ...start, append: true }, status);
    expect((await getMeeting('m1'))?.status).toBe('done');
    await beginCatchup({ meetingId: 'm2', picked }, 'en', 3);
    await undoCatchup({ meetingId: 'm2', picked }, undefined);
    expect(await getMeeting('m2')).toBeUndefined();
  });

  it('a pause saves its voice part and keeps the meeting recording; a stop while paused adds no part', async () => {
    await beginCatchup(start, 'en', 1);
    await addCatchupPart('m1', { at: 1, ms: 60_000, kind: 'voice' }, true);
    expect(await getMeeting('m1')).toMatchObject({ status: 'recording', told: { ms: 60_000 } });
    await endCatchupPart('m1', null, { questionId: 'q1', atMs: 0 });
    expect((await getMeeting('m1'))?.told).toMatchObject({ ms: 60_000, parts: [{ ms: 60_000 }], answers: [{ questionId: 'q1' }] });
    expect((await getMeeting('m1'))?.status).toBe('processing');
  });
});

describe('the telling’s audio', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });
  const start: CatchupStart = { meetingId: 'm1', picked };
  const blob = (text: string) => new Blob([text], { type: 'audio/webm' });
  /** Records one voice part through ContinuousRecording, as the offscreen document does. */
  async function record(part: number, slices: string[]) {
    let emit: (b: Blob) => void = () => undefined;
    const recorder: SliceRecorder = { mimeType: 'audio/webm', start: () => undefined, pause: () => undefined, resume: () => undefined, stop: async () => undefined };
    const r = new ContinuousRecording({
      meetingId: 'm1', startedAt: 0, firstSeq: tellSeqBase(part), newId,
      createRecorder: (onData) => { emit = onData; return recorder; },
      savePart: putRecordingPart, saveMeta: async () => undefined,
    });
    r.start();
    slices.forEach((s) => emit(blob(s)));
    expect(await r.stop()).toBe(true);
  }

  it('finds the part and the time into it for an offset into the joined telling', () => {
    const parts = [{ at: 1, ms: 1000, kind: 'voice' }, { at: 2, ms: 500, kind: 'typed' }, { at: 3, ms: 2000, kind: 'voice' }] as const;
    expect(locateTelling(parts, 400)).toEqual({ part: 0, offsetMs: 0, seekMs: 400 });
    expect(locateTelling(parts, 1200)).toBeNull();
    expect(locateTelling(parts, 2000)).toEqual({ part: 2, offsetMs: 1500, seekMs: 500 });
    expect(locateTelling(parts, 3500)).toEqual({ part: 2, offsetMs: 1500, seekMs: 2000 });
    expect(locateTelling(parts, 9999)).toBeNull();
  });

  it('keeps each voice part as its own file and plays the telling at atMs across parts', async () => {
    await beginCatchup(start, 'en', 1);
    await record(0, ['a', 'b']);
    await endCatchupPart('m1', { at: 1, ms: 60_000, kind: 'voice' });
    await saveTypedPart({ ...start, append: true }, 'Typed words here.', 'en', 2, newId);
    const { offsetMs, part } = await beginCatchup({ ...start, append: true }, 'en', 3);
    expect(part).toBe(2);
    await record(part, ['c']);
    await endCatchupPart('m1', { at: 3, ms: 30_000, kind: 'voice' });

    const audio = await listTellingAudio('m1');
    expect(audio.map((a) => [a.part, a.offsetMs, a.ms])).toEqual([[0, 0, 60_000], [2, offsetMs, 30_000]]);
    expect(await audio[0]!.blob.text()).toBe('ab');
    const at = await tellingAudioAt('m1', offsetMs + 10_000);
    expect(at).toMatchObject({ part: 2, seekMs: 10_000 });
    expect(await at!.blob.text()).toBe('c');
    expect(await tellingAudioAt('m1', 60_000 + 1)).toBeNull(); // typed part
  });

  it('drops audio of a telling that never became a part before the next one starts', async () => {
    await beginCatchup(start, 'en', 1);
    await endCatchupPart('m1', { at: 1, ms: 1000, kind: 'voice' });
    await record(1, ['lost']);
    await beginCatchup({ ...start, append: true }, 'en', 2);
    expect(await listRecordingParts('m1')).toEqual([]);
  });

  it('Delete audio of your telling keeps the segments and sets audioDeleted', async () => {
    await saveTypedPart(start, 'Words.', 'en', 1, newId);
    const { part } = await beginCatchup({ ...start, append: true }, 'en', 2);
    await record(part, ['x']);
    await endCatchupPart('m1', { at: 2, ms: 1000, kind: 'voice' });
    await deleteTellingAudio('m1');
    expect(await listTellingAudio('m1')).toEqual([]);
    expect(await listSegments('m1')).toHaveLength(1);
    expect((await getMeeting('m1'))?.told?.audioDeleted).toBe(true);
    await beginCatchup({ ...start, append: true }, 'en', 3);
    await endCatchupPart('m1', { at: 3, ms: 1000, kind: 'voice' }, undefined, false);
    expect((await getMeeting('m1'))?.told?.audioDeleted).toBe(true);
    await beginCatchup({ ...start, append: true }, 'en', 4);
    await endCatchupPart('m1', { at: 4, ms: 1000, kind: 'voice' }, undefined, true);
    expect((await getMeeting('m1'))?.told?.audioDeleted).toBeUndefined();
  });
});
