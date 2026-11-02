import type { CalendarEvent } from '@/lib/types';

/** How close to a calendar meeting the record bar names it and offers the brief. */
export const NEAR_MS = 10 * 60_000;

/** The meeting starting within 10 minutes, or started up to 10 minutes ago and not over. Closest start wins. */
export function nearMeeting(events: CalendarEvent[], now: number): CalendarEvent | undefined {
  return events
    .filter((e) => e.end > now && Math.abs(e.start - now) <= NEAR_MS)
    .sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now))[0];
}
