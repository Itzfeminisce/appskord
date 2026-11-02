import { clock } from '@/lib/calendar';
import { mergeSuggestions } from '@/lib/memory/link';
import { isoDay, isOpenLoop } from '@/lib/memory/rank';
import { MONTHS, nextMeeting } from '@/lib/memory/series';
import type { MemoryItem, Person, Quote } from '@/lib/memory/types';
import { citationCaption } from '@/lib/askAll';
import { isCatchup } from '@/lib/catchup/label';
import type { CalendarEvent, Meeting } from '@/lib/types';

/** "SC" from "Sarah Chen", "S" from "Sam". */
export function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

const TINTS: [string, string][] = [
  ['#FFE6CC', '#8A4B00'], ['#E3F1F4', '#11616E'], ['#DDF2E6', '#1A6B40'], ['#F3E1F7', '#6E2A86'], ['#DCE9FF', '#1F4E96'],
];
/** A steady tint per name; no email means not linked yet, drawn dashed. */
export function avatarTint(name: string): { background: string; color: string } {
  const [background, color] = TINTS[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % TINTS.length]!;
  return { background, color };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const dayMonth = (at: number) => `${new Date(at).getDate()} ${MONTHS[new Date(at).getMonth()]}`;

/** "today 10:00", "tomorrow 09:30" or "5 Nov 10:00". */
export function whenLabel(at: number, now: number): string {
  const day = isoDay(at);
  if (day === isoDay(now)) return `today ${clock(at)}`;
  if (day === isoDay(now + 86_400_000)) return `tomorrow ${clock(at)}`;
  return `${dayMonth(at)} ${clock(at)}`;
}

/** "in 5 min" within the hour, else as `whenLabel`. */
export function soonLabel(at: number, now: number): string {
  const min = Math.round((at - now) / 60_000);
  return min > 0 && min < 60 ? `in ${min} min` : whenLabel(at, now);
}

/** Promises still open between you and this person. */
export const openPromises = (items: MemoryItem[], personId: string, now: number) =>
  items.filter((i) => i.kind === 'promise' && isOpenLoop(i, now) && (i.ownerId === personId || i.toId === personId || i.personIds.includes(personId)));

export interface PersonRow { person: Person; line: string; open: number; lastMet?: number; next?: CalendarEvent }

/** People rows: who you meet next first, then whom you met last, then most open. */
export function personRows(people: Person[], items: MemoryItem[], meetings: Meeting[], events: CalendarEvent[], now: number): PersonRow[] {
  const byId = new Map(meetings.map((m) => [m.id, m]));
  const rows = people.map((person): PersonRow => {
    const past = person.meetingIds.map((id) => byId.get(id)).filter((m): m is Meeting => !!m && m.startedAt <= now)
      .sort((a, b) => b.startedAt - a.startedAt);
    const next = nextMeeting(person, events, now);
    const contact = next ? `next: ${whenLabel(next.start, now)}` : person.email;
    const parts = [person.company, contact].filter(Boolean);
    const line = parts.length ? parts.join(' · ') : past[0] ? `Guest in ${past[0].title}` : '';
    return { person, line, open: openPromises(items, person.id, now).length, lastMet: past[0]?.startedAt, next };
  });
  return rows.sort((a, b) =>
    (a.next?.start ?? Infinity) - (b.next?.start ?? Infinity) || (b.lastMet ?? 0) - (a.lastMet ?? 0) || b.open - a.open || a.person.name.localeCompare(b.person.name));
}

export function matchesSearch(person: Person, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [person.name, person.email ?? '', person.company ?? '', ...person.aliases].some((s) => s.toLowerCase().includes(q));
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('|');

/** Merge suggestions the user has not already called different people. */
export function openSuggestions(people: Person[], notSame: string[]): [Person, Person][] {
  return mergeSuggestions(people).filter(([a, b]) => !notSame.includes(pairKey(a.id, b.id)));
}

/** "Overdue 4 days", "Due today" or "Due 5 Nov"; nothing without a date. */
export function dueBadge(item: MemoryItem, now: number): { text: string; tone: 'overdue' | 'today' | 'later' } | undefined {
  if (!item.due) return undefined;
  const today = isoDay(now);
  if (item.due === today) return { text: 'Due today', tone: 'today' };
  const [y, m, d] = item.due.split('-').map(Number) as [number, number, number];
  const due = new Date(y, m - 1, d).getTime();
  if (item.due < today) {
    const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
    const days = Math.round((new Date(ty, tm - 1, td).getTime() - due) / 86_400_000);
    return { text: `Overdue ${days} ${days === 1 ? 'day' : 'days'}`, tone: 'overdue' };
  }
  return { text: `Due ${dayMonth(due)}`, tone: 'later' };
}

/** "Sarah · 1:1 with Sarah · 27 Oct · 14:50". */
export function quoteMeta(q: Quote, meeting: Meeting | undefined): string {
  return [q.speaker, meeting?.title, meeting && dayMonth(meeting.startedAt), citationCaption({ atMs: q.atMs, catchup: isCatchup(meeting) })].filter(Boolean).join(' · ');
}

/** The latest quote this person spoke, by their name or an alias. */
export function lastQuoteBy(person: Person, items: MemoryItem[], meetings: Meeting[]): Quote | undefined {
  const names = new Set([person.name, ...person.aliases].map((n) => n.toLowerCase()));
  const start = new Map(meetings.map((m) => [m.id, m.startedAt]));
  const at = (q: Quote) => (start.get(q.meetingId) ?? 0) + q.atMs;
  return items.filter((i) => !i.leftOut && i.status !== 'suggested' && i.status !== 'dismissed')
    .flatMap((i) => [i.quote, ...i.history]).filter((q) => names.has(q.speaker.toLowerCase()))
    .sort((a, b) => at(b) - at(a))[0];
}

/** The merge suggestion this person is part of, loose name first. */
export function suggestionFor(person: Person, people: Person[]): [Person, Person] | undefined {
  return mergeSuggestions(people).find(([a, b]) => a.id === person.id || b.id === person.id);
}
