// Calendar meetings Rekord missed: the Home card (last 24 h) and the picker (last 7 days). Pure.
import type { CalendarEvent, Meeting } from '../types';

const MIN = 60_000;
const HOUR = 60 * MIN;
export const MISSED_WINDOW_MS = 24 * HOUR;
export const PICKER_WINDOW_MS = 7 * 24 * HOUR;
/** A recording without an attached event matches one it started within (or just before). */
const EARLY_START_MS = 10 * MIN;

/** A meeting covers an event when it holds that event, or (no event attached) has its title and started during it. */
export function isMatched(event: CalendarEvent, meetings: readonly Meeting[]): boolean {
  const title = sameTitle(event.title);
  return meetings.some((m) => m.event
    ? m.event.id === event.id
    : sameTitle(m.title) === title && m.startedAt >= event.start - EARLY_START_MS && m.startedAt < event.end);
}

const sameTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');

const ended = (e: CalendarEvent, now: number, windowMs: number) => e.end <= now && e.end > now - windowMs;

/** Events that ended in the last 24 h, had the user as attendee, have no meeting and were not dismissed. */
export function findMissed(events: readonly CalendarEvent[], meetings: readonly Meeting[], dismissedIds: readonly string[], now: number): CalendarEvent[] {
  const dismissed = new Set(dismissedIds);
  return unique(events)
    .filter((e) => ended(e, now, MISSED_WINDOW_MS) && e.attendees.some((a) => a.self) && !dismissed.has(e.id) && !isMatched(e, meetings))
    .sort((a, b) => b.end - a.end);
}

/** The picker's calendar list: events that ended in the last 7 days with no meeting, newest first. */
export function recentForPicker(events: readonly CalendarEvent[], meetings: readonly Meeting[], now: number): CalendarEvent[] {
  return unique(events)
    .filter((e) => ended(e, now, PICKER_WINDOW_MS) && !isMatched(e, meetings))
    .sort((a, b) => b.start - a.start);
}

function unique(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...new Map(events.map((e) => [e.id, e])).values()];
}
