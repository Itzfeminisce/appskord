// Pure view helpers for Open loops, its sheets and the Decisions log.
import { APP_NAMES } from '@/lib/calendar';
import { isoDay } from '@/lib/memory/rank';
import type { MemoryItem, Person, Quote } from '@/lib/memory/types';
import { FROM_CATCHUP, itemMeta, isCatchup } from '@/lib/catchup/label';
import type { CalendarEvent, Meeting } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' as local midnight. */
export function fromIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!).getTime();
}
/** "26 Oct" */
export const dayMonth = (at: number) => { const d = new Date(at); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
/** "Fri 30 Oct" */
export const weekdayDate = (at: number) => `${DAYS[new Date(at).getDay()]} ${dayMonth(at)}`;
/** "TUE" */
export const weekdayShort = (at: number) => DAYS[new Date(at).getDay()]!.toUpperCase();
/** "04:12" into the recording. */
export function quoteClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const mm = `${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return h ? `${h}:${mm}` : mm;
}

export type ChipTone = 'late' | 'today' | 'plain' | 'done';
export interface Chip { label: string; tone: ChipTone }

export function daysLate(due: string, now: number): number {
  return Math.round((fromIso(isoDay(now)) - fromIso(due)) / DAY_MS);
}

/** The due chip on a row and in the sheet. */
export function dueChip(item: MemoryItem, now: number): Chip {
  if (item.status === 'looksDone') return { label: 'Looks done', tone: 'done' };
  if (!item.due) return { label: 'No date', tone: 'plain' };
  const late = daysLate(item.due, now);
  if (late > 0) return { label: `${late} ${late === 1 ? 'day' : 'days'} late`, tone: 'late' };
  if (late === 0) return { label: 'Due today', tone: 'today' };
  return { label: weekdayDate(fromIso(item.due)), tone: 'plain' };
}

export type Meetings = Map<string, Pick<Meeting, 'title' | 'startedAt' | 'source'>>;

/** "Pricing review · 26 Oct", or "Q4 planning with Northwind · 2 Nov · From your catch-up". */
export function meetingLine(meetingId: string, meetings: Meetings): string {
  const m = meetings.get(meetingId);
  if (!m) return '';
  return isCatchup(m) ? `${m.title} · ${dayMonth(m.startedAt)} · ${FROM_CATCHUP}` : `${m.title} · ${dayMonth(m.startedAt)}`;
}
/** "Alex · Pricing review · 26 Oct · 33:40"; a catch-up ends "From your catch-up" instead of the clock. */
export function quoteCaption(q: Quote, meetings: Meetings): string {
  const m = meetings.get(q.meetingId);
  return m ? `${q.speaker} · ${itemMeta(m, quoteClock(q.atMs))}` : [q.speaker, quoteClock(q.atMs)].filter(Boolean).join(' · ');
}
/** The caption of a follow-up answer: `Alex, answering “Tom is setting up admin access for the pilot. By when?” · …`. */
export function answerCaption(q: Quote, question: string, meetings: Meetings): string {
  const m = meetings.get(q.meetingId);
  return `${q.speaker}, answering “${question}”${m ? ` · ${itemMeta(m, quoteClock(q.atMs))}` : ''}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words.at(-1)![0] : '')).toUpperCase();
}

const TINTS: [string, string][] = [
  ['#EAF6EF', '#1A6B40'], ['#E6F4FA', '#0B5575'], ['#EEF0FF', '#3730A3'],
  ['#FDE7F0', '#8A2150'], ['#F1F1F3', '#2A2B31'], ['#FFF0DC', '#8A4B00'],
];
/** A person's avatar fill and text, the same everywhere. */
export function tint(name: string): { background: string; color: string } {
  const [background, color] = TINTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % TINTS.length]!;
  return { background, color };
}

/** The other person on a promise (or the asker of a question). */
export function counterpartId(item: MemoryItem): string | undefined {
  if (item.kind === 'promise') return item.ownerId === 'me' ? item.toId : item.ownerId;
  return item.personIds[0];
}

/** Snooze ends at 09:00 tomorrow, or 09:00 next Monday. */
export function snoozeTimes(now: number): { tomorrow: number; nextWeek: number } {
  const d = new Date(now);
  const at9 = (days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 9).getTime();
  const toMonday = ((8 - d.getDay()) % 7) || 7;
  return { tomorrow: at9(1), nextWeek: at9(toMonday) };
}

/** The next calendar meeting with this person that has not started yet. */
export function nextMeetingWith(person: Person | undefined, events: CalendarEvent[], now: number): CalendarEvent | undefined {
  if (!person) return undefined;
  const emails = new Set([person.email, ...person.aliases].filter(Boolean).map((e) => e!.toLowerCase()));
  return events
    .filter((e) => e.start > now && e.attendees.some((a) => !a.self && (emails.has(a.email.toLowerCase()) || (a.name && a.name === person.name))))
    .sort((a, b) => a.start - b.start)[0];
}

/** "Google Meet" for the brief card. */
export function appLabel(app: CalendarEvent['app']): string | undefined {
  return app === 'meet' ? 'Google Meet' : app ? APP_NAMES[app] : undefined;
}

/** What changed between two decisions: "$12 a seat" and "$10 a seat" from "Team plan is $12 a seat" and "Team plan is $10 a seat". */
export function changedPart(now: string, before: string): [string, string] {
  const a = now.split(' ');
  const b = before.split(' ');
  let i = 0;
  while (i < a.length - 1 && i < b.length - 1 && a[i] === b[i]) i++;
  return [a.slice(i).join(' '), b.slice(i).join(' ')];
}

/** The user's name as their own quotes show it, for the reminder's sign-off. */
export function myName(items: MemoryItem[]): string | undefined {
  const mine = items.find((i) => i.kind === 'promise' && i.ownerId === 'me' && i.quote.speaker && i.quote.speaker !== 'You');
  return mine?.quote.speaker;
}

/** A toast that survives the move from a sheet back to Open loops. */
export interface Toast { text: string; undo: MemoryItem }
let pending: Toast | undefined;
export function setPendingToast(t: Toast | undefined) { pending = t; }
export function takePendingToast(): Toast | undefined { const t = pending; pending = undefined; return t; }

/** When the item was said: its meeting's start plus the quote's time. */
export const saidAt = (i: MemoryItem, meetings: Meetings) => (meetings.get(i.meetingId)?.startedAt ?? i.createdAt) + (meetings.has(i.meetingId) ? i.quote.atMs : 0);

/** Monday 00:00 of last week: "recent" is this week and last. */
export function recentSince(now: number): number {
  const d = new Date(now);
  const sinceMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday - 7).getTime();
}
export interface DecisionCard { item: MemoryItem; before?: MemoryItem }

/**
 * The Decisions log: standing decisions, the ones that replaced another first, then newest first.
 * `recent` counts those from this week and last.
 */
export function decisionLog(all: MemoryItem[], meetings: Meetings, now: number, personId?: string): { cards: DecisionCard[]; recent: number } {
  const byId = new Map(all.map((i) => [i.id, i]));
  const standing = all
    .filter((i) => i.kind === 'decision' && i.status === 'open' && (!personId || i.personIds.includes(personId)))
    .map((item) => {
      const before = item.replacesId ? byId.get(item.replacesId) : undefined;
      return { item, ...(before?.status === 'replaced' ? { before } : {}) };
    });
  standing.sort((a, b) => Number(!!b.before) - Number(!!a.before) || saidAt(b.item, meetings) - saidAt(a.item, meetings));
  return { cards: standing, recent: standing.filter((c) => saidAt(c.item, meetings) >= recentSince(now)).length };
}

/** People to filter by: everyone with an open promise or question, next meeting first, then last met. */
export function filterPeople(people: Person[], items: MemoryItem[], meetings: Meetings, events: CalendarEvent[], now: number): Person[] {
  const linked = new Set(items.filter((i) => i.kind !== 'decision' && (i.status === 'open' || i.status === 'looksDone')).flatMap((i) => i.personIds));
  const lastMet = (p: Person) => Math.max(0, ...p.meetingIds.map((id) => meetings.get(id)?.startedAt ?? 0));
  const next = (p: Person) => nextMeetingWith(p, events, now)?.start ?? Infinity;
  return people
    .filter((p) => linked.has(p.id))
    .sort((a, b) => next(a) - next(b) || lastMet(b) - lastMet(a) || a.name.localeCompare(b.name));
}
