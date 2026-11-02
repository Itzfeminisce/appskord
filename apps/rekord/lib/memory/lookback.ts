// The weekly look back: numbers, columns and the Markdown file. Pure; no I/O.
import type { Meeting } from '../types';
import { daysLate, dayMonth, firstName, weekdayDate } from './brief';
import { isOpenLoop, isoDay } from './rank';
import type { MemoryItem, Person } from './types';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface DecidedRow { item: MemoryItem; replaces?: MemoryItem }
export interface Week {
  start: number; end: number;            // Monday 00:00 to the next Monday 00:00
  label: string;                         // "26 to 30 Oct"
  meetings: number; minutes: number; promisesMade: number; promisesKept: number; decisions: number;
  decided: DecidedRow[];
  kept: MemoryItem[];
  stillOpen: MemoryItem[];
  late: MemoryItem[];
  people: { person: Person; meetings: number }[];
}

/** Monday 00:00 of the week `now` falls in. */
export function weekStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The week a look back shows: the one just ended from Saturday to Monday, else the current one. */
export function lookBackStart(now: number): number {
  return weekStart(new Date(now).getDay() === 1 ? now - 2 * DAY_MS : now);
}

/** "26 to 30 Oct", or "28 Sep to 2 Oct" across months. Monday to Friday. */
export function weekLabel(start: number): string {
  const mon = new Date(start);
  const fri = new Date(start);
  fri.setDate(fri.getDate() + 4);
  return mon.getMonth() === fri.getMonth()
    ? `${mon.getDate()} to ${fri.getDate()} ${MONTHS[fri.getMonth()]}`
    : `${dayMonth(mon.getTime())} to ${dayMonth(fri.getTime())}`;
}

/** "6 h 40 min", "40 min", "2 h". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const LIVE = new Set<MemoryItem['status']>(['open', 'looksDone', 'done', 'dropped', 'answered', 'replaced']);

export function buildWeek(input: { meetings: Meeting[]; items: MemoryItem[]; people: Person[]; now: number; start?: number }): Week {
  const { meetings, items, people, now } = input;
  const start = input.start ?? weekStart(now);
  const end = start + 7 * DAY_MS;
  const inWeek = (t: number) => t >= start && t < end;
  const held = meetings.filter((m) => inWeek(m.startedAt) && m.status !== 'error');
  const minutes = Math.round(held.reduce((sum, m) => sum + Math.max(0, (m.endedAt ?? m.startedAt) - m.startedAt), 0) / 60_000);
  const made = items.filter((i) => i.kind === 'promise' && LIVE.has(i.status) && inWeek(i.createdAt));
  const kept = items.filter((i) => i.kind === 'promise' && i.status === 'done' && inWeek(i.updatedAt)).sort((a, b) => b.updatedAt - a.updatedAt);
  const decided = items.filter((i) => i.kind === 'decision' && (i.status === 'open' || i.status === 'replaced') && inWeek(i.createdAt));
  const byId = new Map(items.map((i) => [i.id, i]));
  const decidedRows = decided.filter((i) => i.status === 'open')
    .map((item) => ({ item, replaces: item.replacesId ? byId.get(item.replacesId) : undefined }))
    .sort((a, b) => Number(!!b.replaces) - Number(!!a.replaces) || b.item.createdAt - a.item.createdAt);
  const stillOpen = items
    .filter((i) => i.status === 'open' && isOpenLoop(i, now) && inWeek(i.createdAt) && (i.kind === 'question' || i.ownerId === 'me'))
    .sort((a, b) => Number(!a.due) - Number(!b.due) || (a.due ?? '').localeCompare(b.due ?? '') || a.createdAt - b.createdAt);
  const late = items
    .filter((i) => i.kind === 'promise' && i.status === 'open' && !!i.due && daysLate(i.due, now) > 7)
    .sort((a, b) => a.due!.localeCompare(b.due!));
  const heldIds = new Set(held.map((m) => m.id));
  const met = people
    .map((person) => ({ person, meetings: person.meetingIds.filter((id) => heldIds.has(id)).length }))
    .filter((p) => p.meetings > 0)
    .sort((a, b) => b.meetings - a.meetings || a.person.name.localeCompare(b.person.name))
    .slice(0, 3);
  return {
    start, end, label: weekLabel(start),
    meetings: held.length, minutes, promisesMade: made.length, promisesKept: kept.length, decisions: decided.length,
    decided: decidedRows, kept, stillOpen, late, people: met,
  };
}

/** The chip and line under a Still open row: "Due today" with "To Sarah · due Fri 30 Oct", "To Dana", or "Question". */
export function openRowLabels(item: MemoryItem, people: Map<string, Person>, now: number): { chip: string; tone: 'late' | 'promise' | 'question'; line?: string } {
  if (item.kind === 'question') return { chip: 'Question', tone: 'question' };
  const to = `To ${firstName(people.get(item.toId ?? '')?.name ?? '')}`.trim();
  if (!item.due) return { chip: to, tone: 'promise' };
  const late = daysLate(item.due, now);
  const chip = late > 0 ? `${late} ${late === 1 ? 'day' : 'days'} late` : late === 0 ? 'Due today' : weekdayDate(dueAt(item.due));
  return { chip, tone: late >= 0 ? 'late' : 'promise', line: `${to} · due ${weekdayDate(dueAt(item.due))}` };
}
const dueAt = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y!, m! - 1, d!).getTime(); };

/** "Carry to next week": a dated promise moves its due date a week on; an undated one gets next week's same day. */
export function carriedDue(item: MemoryItem, now: number): string {
  const base = item.due && daysLate(item.due, now) < 0 ? dueAt(item.due) : now;
  return isoDay(base + 7 * DAY_MS);
}

export const lookBackPath = (week: Pick<Week, 'start'>) => `Weeks/${isoDay(week.start)} Your week.md`;

/** The week as Markdown, with the frame's headings. */
export function lookBackMarkdown(week: Week, people: Map<string, Person>, now: number): string {
  const list = (rows: string[]) => (rows.length ? rows.map((r) => `- ${r}`) : ['- None']);
  return [
    `# Your week · ${week.label}`, '',
    ...list([
      `${week.meetings} meetings`, `${durationLabel(week.minutes)} in meetings`,
      `${week.promisesMade} promises made`, `${week.promisesKept} promises kept`, `${week.decisions} decisions`,
    ]), '',
    '## Decided this week', '',
    ...list(week.decided.map((d) => (d.replaces ? `${d.item.text} (Replaces: ${d.replaces.text})` : d.item.text))), '',
    '## Kept', '',
    ...list(week.kept.map((i) => i.text)), '',
    '## Still open going into next week', '',
    ...list(week.stillOpen.map((i) => { const l = openRowLabels(i, people, now); return `${i.text} (${l.line ?? l.chip})`; })), '',
    '## People you met most', '',
    ...list(week.people.map((p) => `${p.person.name}: ${p.meetings} meetings`)), '',
    '## Late more than a week', '',
    ...list(week.late.map((i) => `${i.text} (${daysLate(i.due!, now)} days late)`)), '',
  ].join('\n');
}

