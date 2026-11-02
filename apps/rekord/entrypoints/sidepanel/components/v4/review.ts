// Pure helpers for the review card and summary strip: labels, dates and person suggestions.
import { mergeSuggestions } from '@/lib/memory/link';
import type { ItemKind, MemoryItem, Person, Quote } from '@/lib/memory/types';
import type { Meeting } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the local day of `ms`. */
export const isoDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y!, m! - 1, d!); };
const addDays = (ms: number, days: number) => { const d = new Date(ms); d.setDate(d.getDate() + days); return d.getTime(); };

/** "Thu 5 Nov". */
export const dayLabel = (iso: string) => { const d = fromIso(iso); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
/** "3 Nov". */
export const shortDate = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
/** "Tue 3 Nov · 10:00". */
export const meetingWhen = (ms: number) => { const d = new Date(ms); return `${DAYS[d.getDay()]} ${shortDate(ms)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** Recording time "16:05" (or "1:02:10"). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = pad(Math.floor((s % 3600) / 60));
  return h ? `${h}:${mm}:${pad(s % 60)}` : `${mm}:${pad(s % 60)}`;
}
/** "1:1 with Sarah · 3 Nov · 16:05". */
export const quoteMeta = (q: Quote, meeting: Pick<Meeting, 'title' | 'startedAt'>) => `${meeting.title} · ${shortDate(meeting.startedAt)} · ${clock(q.atMs)}`;

export type DueChoice = 'today' | 'tomorrow' | 'friday' | 'nextWeek';
export const DUE_LABEL: Record<DueChoice, string> = { today: 'Today', tomorrow: 'Tomorrow', friday: 'Friday', nextWeek: 'Next week' };
/** The date a quick "By when" chip means, from `now`. Friday is the coming Friday, never today. */
export function dueFor(choice: DueChoice, now: number): string {
  if (choice === 'today') return isoDay(now);
  if (choice === 'tomorrow') return isoDay(addDays(now, 1));
  if (choice === 'nextWeek') return isoDay(addDays(now, 7));
  const day = new Date(now).getDay();
  return isoDay(addDays(now, ((5 - day + 7) % 7) || 7));
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? parts[0]![0]! + parts.at(-1)![0]! : parts[0]![0]!).toUpperCase();
}

type Names = (id?: string) => string | undefined;

/** "You owe Sarah", "Sarah owes you"; undefined until the owner is known. */
export function ownerChip(item: MemoryItem, nameOf: Names): string | undefined {
  if (!item.ownerId) return undefined;
  const owner = item.ownerId === 'me' ? 'You' : firstName(nameOf(item.ownerId) ?? '');
  const to = item.toId === 'me' ? 'you' : item.toId ? firstName(nameOf(item.toId) ?? '') : undefined;
  if (item.ownerId === 'me') return to ? `You owe ${to}` : undefined;
  return to ? `${owner} owes ${to}` : undefined;
}

/** An earlier open promise this one moves to a new date: same owner and text, another due date. */
export function movedFrom(item: MemoryItem, earlier: MemoryItem[]): MemoryItem | undefined {
  if (item.kind !== 'promise' || !item.due) return undefined;
  const text = item.text.trim().toLowerCase();
  return earlier.find((e) => e.kind === 'promise' && e.id !== item.id && e.meetingId !== item.meetingId
    && (e.status === 'open' || e.status === 'looksDone') && e.ownerId === item.ownerId
    && e.text.trim().toLowerCase() === text && e.due !== item.due);
}

/** "Due today (moved from Fri 30 Oct)", "Thu 5 Nov", "No date". */
export function dueChip(item: MemoryItem, now: number, moved?: MemoryItem): string {
  if (!item.due) return 'No date';
  const label = item.due === isoDay(now) ? 'Due today' : dayLabel(item.due);
  return moved?.due ? `${label} (moved from ${dayLabel(moved.due)})` : label;
}

export const GROUPS: { kind: ItemKind; label: string }[] = [
  { kind: 'promise', label: 'Promises' },
  { kind: 'decision', label: 'Decisions' },
  { kind: 'question', label: 'Questions' },
];

/** Items still waiting for the user, and those whose quote was not in the transcript. */
export function reviewItems(items: MemoryItem[]): { waiting: MemoryItem[]; leftOut: MemoryItem[] } {
  const suggested = items.filter((i) => i.status === 'suggested').sort((a, b) => a.quote.atMs - b.quote.atMs);
  return { waiting: suggested.filter((i) => !i.leftOut), leftOut: suggested.filter((i) => i.leftOut) };
}

export type PersonSuggestion =
  | { type: 'same'; loose: Person; person: Person }   // "Is “Tom” Tom Becker (tom@northwind.co)?"
  | { type: 'new'; person: Person };                  // "New: Dana Ruiz · dana@lumen.io"

export const reviewedPeopleKey = (meetingId: string) => `rekord.review.people.${meetingId}`;

/** People this meeting may have got wrong: a loose name that may be someone known, or someone first met here. */
export function personSuggestions(people: Person[], meetingId: string, reviewed: string[]): PersonSuggestion[] {
  const here = people.filter((p) => p.meetingIds.includes(meetingId));
  const done = new Set(reviewed);
  const out: PersonSuggestion[] = [];
  const paired = new Set<string>();
  for (const [loose, person] of mergeSuggestions(people)) {
    if (!here.includes(loose) || done.has(loose.id) || person.id === loose.id) continue;
    paired.add(loose.id).add(person.id);
    out.push({ type: 'same', loose, person });
  }
  for (const p of here) {
    if (paired.has(p.id) || done.has(p.id) || p.meetingIds.length !== 1 || !p.email) continue;
    out.push({ type: 'new', person: p });
  }
  return out;
}

/** People to pick as owner or recipient: everyone in the meeting or its items, except a loose name awaiting a merge answer. */
export function meetingPeople(people: Person[], meetingId: string, items: MemoryItem[] = []): Person[] {
  const loose = new Set(mergeSuggestions(people).map(([l]) => l.id));
  const touched = new Set(items.filter((i) => i.meetingId === meetingId).flatMap((i) => i.personIds));
  return people.filter((p) => (p.meetingIds.includes(meetingId) || touched.has(p.id)) && !loose.has(p.id)).sort((a, b) => a.createdAt - b.createdAt);
}

/** "4 promises", "1 decision", "1 person". */
export function countLabel(n: number, kind: ItemKind | 'person'): string {
  const one = { promise: 'promise', decision: 'decision', question: 'question', person: 'person' }[kind];
  const many = { promise: 'promises', decision: 'decisions', question: 'questions', person: 'people' }[kind];
  return n === 1 ? one : many;
}
