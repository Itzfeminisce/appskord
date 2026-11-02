// Brief content: who is coming, last time, what is open between you, and the notification text. Pure; no I/O.
import type { CalendarEvent, Meeting } from '../types';
import { isOpenLoop, isoDay } from './rank';
import type { MemoryItem, Person } from './types';

const DAY_MS = 86_400_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface BriefPerson { name: string; email: string; person?: Person; known: boolean }
export interface BriefRow { item: MemoryItem; label: string; kind: 'promise' | 'question' }
export interface Brief {
  event: CalendarEvent;
  who: BriefPerson[];
  /** Nobody on the invite has met you in a recorded meeting. */
  firstMeeting: boolean;
  last?: Pick<Meeting, 'id' | 'title' | 'startedAt'>;
  /** "You owe Sarah", "Sarah owes you", "Still open", in that order. */
  rows: BriefRow[];
}

export interface BriefInput { event: CalendarEvent; people: Person[]; items: MemoryItem[]; meetings: Meeting[]; now: number }

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function emailName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.split(/[._-]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || email;
}

/** Matches each guest (not you) to a person by email, then by name. */
export function guests(event: CalendarEvent, people: Person[]): BriefPerson[] {
  return event.attendees.filter((a) => !a.self).map((a) => {
    const email = a.email.toLowerCase();
    const name = a.name?.trim();
    const person = people.find((p) => p.email?.toLowerCase() === email)
      ?? (name ? people.find((p) => p.name === name || p.aliases.includes(name)) : undefined);
    return { name: person?.name ?? name ?? emailName(a.email), email: a.email, person, known: !!person && person.meetingIds.length > 0 };
  });
}

/** The last recorded meeting with these guests: the same series (title) first, else any meeting with one of them. */
function lastMeeting(event: CalendarEvent, who: BriefPerson[], meetings: Meeting[], now: number): Brief['last'] {
  const ids = new Set(who.flatMap((w) => w.person?.meetingIds ?? []));
  const past = meetings.filter((m) => ids.has(m.id) && m.startedAt < Math.min(now, event.start)).sort((a, b) => b.startedAt - a.startedAt);
  const m = past.find((p) => p.title === event.title) ?? past[0];
  return m ? { id: m.id, title: m.title, startedAt: m.startedAt } : undefined;
}

/** Promises between you and a guest due by the meeting day (or with no date), and open questions they touch. */
export function buildBrief({ event, people, items, meetings, now }: BriefInput): Brief {
  const who = guests(event, people);
  const ids = new Map(who.filter((w) => w.person).map((w) => [w.person!.id, w.person!]));
  const meetingDay = isoDay(event.start);
  const open = items.filter((i) => isOpenLoop(i, now) && (!i.due || i.due <= meetingDay))
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt);
  const rows: BriefRow[] = [];
  for (const i of open) {
    if (i.kind === 'promise' && i.ownerId === 'me' && i.toId && ids.has(i.toId)) rows.push({ item: i, label: `You owe ${firstName(ids.get(i.toId)!.name)}`, kind: 'promise' });
  }
  for (const i of open) {
    if (i.kind === 'promise' && i.toId === 'me' && i.ownerId && ids.has(i.ownerId)) rows.push({ item: i, label: `${firstName(ids.get(i.ownerId)!.name)} owes you`, kind: 'promise' });
  }
  for (const i of open) {
    if (i.kind === 'question' && i.personIds.some((p) => ids.has(p))) rows.push({ item: i, label: 'Still open', kind: 'question' });
  }
  return { event, who, firstMeeting: who.length > 0 && who.every((w) => !w.known), last: lastMeeting(event, who, meetings, now), rows };
}

/** "26 Oct" */
export const dayMonth = (at: number) => { const d = new Date(at); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
/** "Thu 5 Nov" */
export const weekdayDate = (at: number) => `${DAYS[new Date(at).getDay()]} ${dayMonth(at)}`;
/** "10:00" */
export const clockOf = (at: number) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export const APP_LABEL: Record<NonNullable<CalendarEvent['app']>, string> = { meet: 'Google Meet', zoom: 'Zoom', teams: 'Microsoft Teams' };

/** Minutes until the start, rounded up; 0 once it started. */
export const minutesUntil = (start: number, now: number) => Math.max(0, Math.ceil((start - now) / 60_000));

/** "in 5 min" within the hour; otherwise the day ("Thu 5 Nov") and the clock shown beside it. */
export function whenChip(event: CalendarEvent, now: number): { soon: boolean; label: string } {
  const m = minutesUntil(event.start, now);
  if (event.start > now && m <= 60) return { soon: true, label: `in ${m} min` };
  if (event.start <= now && event.end > now) return { soon: true, label: 'now' };
  return { soon: false, label: weekdayDate(event.start) };
}

const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y!, m! - 1, d!).getTime(); };
export const daysLate = (due: string, now: number) => Math.round((fromIso(isoDay(now)) - fromIso(due)) / DAY_MS);

/** The due chip: "4 days late", "Due today", "Thu 5 Nov", or none. */
export function dueLabel(item: MemoryItem, now: number): { label: string; tone: 'late' | 'today' | 'plain' } | undefined {
  if (!item.due) return undefined;
  const late = daysLate(item.due, now);
  if (late > 0) return { label: `${late} ${late === 1 ? 'day' : 'days'} late`, tone: 'late' };
  if (late === 0) return { label: 'Due today', tone: 'today' };
  return { label: weekdayDate(fromIso(item.due)), tone: 'plain' };
}

// Words that qualify the thing but are not needed to name it in a one-line notification.
const QUALIFIERS = /\b(revised|updated|final|latest|new)\s+/gi;
/** "Send the revised pricing deck" → "the pricing deck"; "Q3 usage numbers" stays. */
export function shortPhrase(text: string): string {
  const rest = text.trim().replace(/^(send|share|get|give|write|book|update|make|finish|prepare|review|draft|deliver|bring)\s+/i, '').replace(QUALIFIERS, '');
  return /^[A-Z][A-Z0-9]/.test(rest) ? rest : rest.charAt(0).toLowerCase() + rest.slice(1);
}
const withoutArticle = (phrase: string) => phrase.replace(/^(the|a|an)\s+/i, '');

export interface NoteContent { title: string; message: string; buttons: { title: string }[] }

/** "Brief · 1:1 with Sarah in 5 min" / "You owe the pricing deck (4 days late). Sarah owes Q3 numbers today." */
export function briefNote(brief: Brief, now: number): NoteContent {
  const mine = brief.rows.find((r) => r.kind === 'promise' && r.item.ownerId === 'me');
  const theirs = brief.rows.find((r) => r.kind === 'promise' && r.item.toId === 'me');
  const suffix = (i: MemoryItem) => {
    const due = dueLabel(i, now);
    return due?.tone === 'late' ? ` (${due.label})` : due?.tone === 'today' ? ' today' : '';
  };
  const parts = [
    mine && `You owe ${shortPhrase(mine.item.text)}${suffix(mine.item)}.`,
    theirs && `${theirs.label.replace(/ owes you$/, ' owes')} ${shortPhrase(theirs.item.text)}${suffix(theirs.item)}.`,
  ].filter(Boolean);
  return {
    title: `Brief · ${brief.event.title} in ${minutesUntil(brief.event.start, now)} min`,
    message: parts.join(' '),
    buttons: [{ title: 'Open brief' }],
  };
}

/** "Due today: Sarah’s Q3 usage numbers" / "Sarah owes you these today, before your 1:1." */
export function dueNote(item: MemoryItem, owner: Person, events: CalendarEvent[], now: number): NoteContent {
  const first = firstName(owner.name);
  const thing = withoutArticle(shortPhrase(item.text));
  const plural = /[^s]s$/i.test(thing.split(/\s+/).at(-1) ?? '');
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const meeting = events
    .filter((e) => e.start > now && e.start <= end.getTime() && e.attendees.some((a) => a.email.toLowerCase() === owner.email?.toLowerCase()))
    .sort((a, b) => a.start - b.start)[0];
  const short = meeting?.title.replace(new RegExp(`\\s+with\\s+${first}\\b.*$`, 'i'), '').trim();
  return {
    title: `Due today: ${first}’s ${thing}`,
    message: `${first} owes you ${plural ? 'these' : 'this'} today${short ? `, before your ${short}` : ''}.`,
    buttons: [{ title: 'Nudge' }, { title: 'Snooze' }],
  };
}

/** Promises owed to you due today, for the due-day notification. */
export function dueToday(items: MemoryItem[], now: number): MemoryItem[] {
  const today = isoDay(now);
  return items.filter((i) => i.kind === 'promise' && i.toId === 'me' && i.ownerId && i.due === today && isOpenLoop(i, now));
}

// "Last time" in three lines: the brief's one AI call.

/** What the AI gets: the last meeting's title, date, summary and remembered items. No transcript. */
export function lastTimeMessages(last: NonNullable<Brief['last']>, overview: string | undefined, items: MemoryItem[], people: Person[]): { role: 'system' | 'user'; content: string }[] {
  const name = (id?: string) => (id === 'me' ? 'you' : people.find((p) => p.id === id)?.name ?? 'someone');
  const lines = items.map((i) => {
    if (i.kind === 'promise') return `- Promise: ${name(i.ownerId)} owes ${name(i.toId)} "${i.text}"${i.due ? ` (due ${i.due})` : ''}`;
    return `- ${i.kind === 'decision' ? 'Decision' : 'Question'}: ${i.text}`;
  });
  const said = items.flatMap((i) => i.history.filter((q) => q.meetingId === last.id).map((q) => `- ${q.speaker} said: "${q.text}"`));
  return [
    { role: 'system', content: 'You write a meeting brief. Reply with exactly three short lines, one fact each, plain sentences under 12 words, no bullets or numbers. Address the reader as "you". Use only the facts given.' },
    { role: 'user', content: [`Last meeting: ${last.title} on ${dayMonth(last.startedAt)}.`, overview ? `Summary: ${overview}` : '', 'Remembered:', ...lines, ...said].filter(Boolean).join('\n').slice(0, 12_000) },
  ];
}

/** Three clean lines from the reply. */
export function parseLines(raw: string): string[] {
  return raw.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).slice(0, 3);
}

/** Without an AI connection: the last meeting's decisions and promises, in three lines. */
export function localLastTime(lastId: string, items: MemoryItem[], people: Person[]): string[] {
  const first = (id?: string) => firstName(people.find((p) => p.id === id)?.name ?? '');
  const from = items.filter((i) => i.meetingId === lastId && ['open', 'looksDone', 'done', 'answered'].includes(i.status));
  const lines = [
    ...from.filter((i) => i.kind === 'decision').map((i) => `${i.text}.`),
    ...from.filter((i) => i.kind === 'promise' && i.toId === 'me').map((i) => `${first(i.ownerId)} owes you ${shortPhrase(i.text)}.`),
    ...from.filter((i) => i.kind === 'promise' && i.ownerId === 'me').map((i) => `You owe ${first(i.toId)} ${shortPhrase(i.text)}.`),
    ...from.filter((i) => i.kind === 'question').map((i) => i.text),
  ];
  return lines.slice(0, 3);
}

