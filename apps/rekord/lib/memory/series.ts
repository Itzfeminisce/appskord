import type { CalendarEvent, Meeting } from '../types';
import type { Person } from './types';

/** T12 redaction flips this when `lib/redact.ts` lands; until then Forget offers the option disabled. */
export const canRedactPerson = false;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "Every Tuesday 10:00" when at least 3 meetings, and most of them, share a weekday and start time. */
export function detectSeries(starts: number[]): Person['series'] {
  const slots = new Map<string, number[]>();
  for (const at of starts) {
    const d = new Date(at);
    const key = `${DAYS[d.getDay()]} ${hhmm(d)}`;
    slots.set(key, [...(slots.get(key) ?? []), at]);
  }
  const best = [...slots.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!best || best[1].length < 3 || best[1].length * 2 <= starts.length) return undefined;
  return { label: `Every ${best[0]}`, since: Math.min(...best[1]) };
}

export interface SeriesLine { label?: string; count: number; since?: string }

/** The person's meetings as "Every Tuesday 10:00 · 6 meetings since Sep": the series from their invites, or found in their meetings. */
export function seriesLine(person: Person, meetings: Meeting[]): SeriesLine {
  const mine = meetings.filter((m) => person.meetingIds.includes(m.id));
  const starts = mine.map((m) => m.startedAt);
  const series = person.series ?? detectSeries(starts);
  const first = starts.length ? Math.min(...starts) : series?.since;
  return { label: series?.label, count: mine.length, since: first === undefined ? undefined : MONTHS[new Date(first).getMonth()] };
}

/** The person's next calendar meeting that has not ended, matched by email or name. */
export function nextMeeting(person: Person, events: CalendarEvent[], now: number): CalendarEvent | undefined {
  const names = [person.name, ...person.aliases].map((n) => n.toLowerCase());
  const theirs = (e: CalendarEvent) => e.attendees.some((a) =>
    !a.self && ((person.email && a.email.toLowerCase() === person.email.toLowerCase()) || (a.name && names.includes(a.name.toLowerCase()))));
  return events.filter((e) => e.end > now && theirs(e)).sort((a, b) => a.start - b.start)[0];
}
