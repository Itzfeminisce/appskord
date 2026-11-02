// A catch-up's capture: the telling clock, its limit, the meeting record and its parts. Pure.
import type { Meeting, Segment } from '../types';
import type { CatchupAnswer, PickedMeeting, TellPart, Told } from './types';

const MIN = 60_000;
/** One telling (all parts and voice answers) is at most 60 minutes; a warning shows at 55:00 (CONTRACT "Limits"). */
export const TELL_LIMIT_MS = 60 * MIN;
export const TELL_WARN_MS = 55 * MIN;
/** Typed text has no audio; each word counts as this much telling so later parts and quotes keep their order. */
export const TYPED_MS_PER_WORD = 400;

/** The Catch up screen's draft: telling, "Stop catching up?" after Back, or "Add more" on the same meeting. */
export type DraftState = 'telling' | 'confirmStop' | 'adding';

/**
 * Telling time only. `offsetMs`: the telling before this part (segments continue after it); `ms`: this part's
 * telling up to `since`; `since`: epoch ms of the last start or resume, missing while paused.
 */
export interface TellClock { offsetMs: number; ms: number; since?: number }

export const startClock = (now: number, offsetMs = 0): TellClock => ({ offsetMs, ms: 0, since: now });
export const isPaused = (c: TellClock): boolean => c.since === undefined;
/** This part's telling so far. */
export const partMs = (c: TellClock, now: number): number => c.ms + (c.since === undefined ? 0 : Math.max(0, now - c.since));
/** The whole telling so far, as the screen's clock shows it and as segment times count. */
export const clockMs = (c: TellClock, now: number): number => c.offsetMs + partMs(c, now);
/** This part's length, capped so the whole telling never passes 60 minutes. */
export const cappedPartMs = (c: TellClock, now: number): number => Math.max(0, Math.min(partMs(c, now), TELL_LIMIT_MS - c.offsetMs));
export const pauseClock = (c: TellClock, now: number): TellClock => (isPaused(c) ? c : { offsetMs: c.offsetMs, ms: partMs(c, now) });
export const resumeClock = (c: TellClock, now: number): TellClock => (isPaused(c) ? { ...c, since: now } : c);

/** 'warn' from 55:00, 'stop' at 60:00. */
export function limitState(ms: number): 'ok' | 'warn' | 'stop' {
  if (ms >= TELL_LIMIT_MS) return 'stop';
  return ms >= TELL_WARN_MS ? 'warn' : 'ok';
}

/** The meeting's title, times and calendar event (CONTRACT "Types", PickedMeeting). Form times are local. */
export function pickedTimes(picked: PickedMeeting): Pick<Meeting, 'title' | 'startedAt' | 'endedAt' | 'event'> {
  if (picked.kind === 'event') {
    const { event } = picked;
    return { title: event.title, startedAt: event.start, endedAt: event.end, event };
  }
  const { form } = picked;
  const [y = 0, mo = 1, d = 1] = form.date.split('-').map(Number);
  const [h = 0, mi = 0] = form.start.split(':').map(Number);
  const startedAt = new Date(y, mo - 1, d, h, mi).getTime();
  return { title: form.name.trim() || 'Untitled meeting', startedAt, endedAt: startedAt + form.lengthMin * MIN };
}

/** A new catch-up: the picked meeting's times, `source: 'catchup'`, and an empty telling that starts now. */
export function newCatchupMeeting(id: string, picked: PickedMeeting, language: Meeting['language'], now: number): Meeting {
  return { id, ...pickedTimes(picked), status: 'recording', language, source: 'catchup', told: { at: now, ms: 0, parts: [] } };
}

/** Appends a part (and a voice answer) to the telling; the next part's segments start at the new `ms`. */
export function addPart(told: Told, part: TellPart, answer?: CatchupAnswer): Told {
  return {
    ...told,
    ms: told.ms + part.ms,
    parts: [...told.parts, part],
    ...((told.typed || part.kind === 'typed') && { typed: true }),
    ...(answer && { answers: [...(told.answers ?? []).filter((a) => a.questionId !== answer.questionId), answer] }),
  };
}

/** Typed or pasted text as `you` segments of one typed part, starting at `offsetMs`. Empty text gives no part. */
export function typedPart(meetingId: string, text: string, offsetMs: number, now: number, newId: () => string): { part: TellPart; segments: Segment[] } | null {
  const lines = text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const chunkId = newId();
  let at = offsetMs;
  const segments = lines.map((line): Segment => {
    const startMs = at;
    at += line.split(' ').length * TYPED_MS_PER_WORD;
    return { id: newId(), meetingId, speaker: 'you', startMs, endMs: at, text: line, chunkId };
  });
  return { part: { at: now, ms: at - offsetMs, kind: 'typed' }, segments };
}
