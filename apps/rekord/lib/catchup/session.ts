// A catch-up's capture: the telling clock, its limit, the meeting record and its parts. Pure.
import type { Meeting, Segment } from '../types';
import type { CatchupAnswer, PickedMeeting, TellPart, Told } from './types';

const MIN = 60_000;
/** The Catch up screen connects a port of this name while it tells; the background stops the telling when it closes. */
export const TELL_PORT = 'rekord:tell';
/** A form catch-up keeps its attendees in an `event` with this id prefix; it is no calendar event. */
export const FORM_EVENT_PREFIX = 'form:';
// Per telling, not per meeting: at the limit V41States says "You can add more from the meeting page".
// A pause splits a telling into voice parts (one audio file each) but the limit counts the whole telling, so
// pausing never buys more than 60 minutes on one screen.
/** Each telling (one Catch up screen or voice answer, pauses excluded) is at most 60 minutes; a warning shows at 55:00. */
export const TELL_LIMIT_MS = 60 * MIN;
export const TELL_WARN_MS = 55 * MIN;
/** Typed text has no audio; each word counts as this much telling so later parts and quotes keep their order. */
export const TYPED_MS_PER_WORD = 400;

/** The Catch up screen's draft: telling, "Stop catching up?" after Back, or "Add more" on the same meeting. */
export type DraftState = 'telling' | 'confirmStop' | 'adding';

/**
 * Telling time only. `offsetMs`: the telling before this screen's telling (segments continue after it); `ms`: this
 * telling up to `since`, across pauses; `since`: epoch ms of the last start or resume, missing while paused.
 */
export interface TellClock { offsetMs: number; ms: number; since?: number }

export const startClock = (now: number, offsetMs = 0): TellClock => ({ offsetMs, ms: 0, since: now });
export const isPaused = (c: TellClock): boolean => c.since === undefined;
/** This telling so far (every voice part since the screen started). */
export const partMs = (c: TellClock, now: number): number => c.ms + (c.since === undefined ? 0 : Math.max(0, now - c.since));
/** The whole telling so far, as the screen's clock shows it and as segment times count. */
export const clockMs = (c: TellClock, now: number): number => c.offsetMs + partMs(c, now);
/** This telling's length, capped at 60 minutes. */
export const cappedPartMs = (c: TellClock, now: number): number => Math.max(0, Math.min(partMs(c, now), TELL_LIMIT_MS));
export const pauseClock = (c: TellClock, now: number): TellClock => (isPaused(c) ? c : { offsetMs: c.offsetMs, ms: partMs(c, now) });
export const resumeClock = (c: TellClock, now: number): TellClock => (isPaused(c) ? { ...c, since: now } : c);

/** 'warn' from 55:00, 'stop' at 60:00 of one telling (`partMs`). */
export function limitState(ms: number): 'ok' | 'warn' | 'stop' {
  if (ms >= TELL_LIMIT_MS) return 'stop';
  return ms >= TELL_WARN_MS ? 'warn' : 'ok';
}

/**
 * The meeting's title, times and attendees (CONTRACT "Types", PickedMeeting). Form times are local; form attendees
 * go in an `event` of their own (id `form:<meetingId>`), where the rest of the app reads a meeting's attendees.
 */
export function pickedTimes(picked: PickedMeeting, meetingId = ''): Pick<Meeting, 'title' | 'startedAt' | 'endedAt' | 'event'> {
  if (picked.kind === 'event') {
    const { event } = picked;
    return { title: event.title, startedAt: event.start, endedAt: event.end, event };
  }
  const { form } = picked;
  const [y = 0, mo = 1, d = 1] = form.date.split('-').map(Number);
  const [h = 0, mi = 0] = form.start.split(':').map(Number);
  const startedAt = new Date(y, mo - 1, d, h, mi).getTime();
  const title = form.name.trim() || 'Untitled meeting';
  const endedAt = startedAt + form.lengthMin * MIN;
  const attendees = form.attendees
    .map((a) => ({ name: a.name?.trim() || undefined, email: a.email?.trim() ?? '' }))
    .filter((a) => a.name || a.email)
    .map((a) => ({ ...(a.name && { name: a.name }), email: a.email }));
  if (attendees.length === 0) return { title, startedAt, endedAt };
  return { title, startedAt, endedAt, event: { id: `${FORM_EVENT_PREFIX}${meetingId}`, title, start: startedAt, end: endedAt, attendees } };
}

/** A new catch-up: the picked meeting's times, `source: 'catchup'`, and an empty telling that starts now. */
export function newCatchupMeeting(id: string, picked: PickedMeeting, language: Meeting['language'], now: number): Meeting {
  return { id, ...pickedTimes(picked, id), status: 'recording', language, source: 'catchup', told: { at: now, ms: 0, parts: [] } };
}

/**
 * Appends a part (and a voice answer) to the telling; the next part's segments start at the new `ms`. `audio`: the
 * part kept audio, so "Delete audio of your telling" no longer covers the whole telling.
 */
export function addPart(told: Told, part: TellPart | null, answer?: CatchupAnswer, audio = false): Told {
  const { audioDeleted, ...rest } = told;
  return {
    ...rest,
    ...(audioDeleted && !audio && { audioDeleted }),
    ms: told.ms + (part?.ms ?? 0),
    parts: part ? [...told.parts, part] : told.parts,
    ...((told.typed || part?.kind === 'typed') && { typed: true }),
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

/** A voice part's audio slices are RecordingParts with seq `part * TELL_SEQ_STRIDE + n` (part: its index in `told.parts`). */
export const TELL_SEQ_STRIDE = 1_000_000;
export const tellSeqBase = (part: number): number => part * TELL_SEQ_STRIDE;
export const partOfSeq = (seq: number): number => Math.floor(seq / TELL_SEQ_STRIDE);

/** Where `atMs` (an offset into the joined telling) falls: the voice part and the time into it. Null in a typed part. */
export function locateTelling(parts: readonly TellPart[], atMs: number): { part: number; offsetMs: number; seekMs: number } | null {
  let offsetMs = 0;
  for (const [part, p] of parts.entries()) {
    const end = offsetMs + p.ms;
    if (atMs >= offsetMs && (atMs < end || (atMs === end && part === parts.length - 1))) {
      return p.kind === 'voice' ? { part, offsetMs, seekMs: atMs - offsetMs } : null;
    }
    offsetMs = end;
  }
  return null;
}
