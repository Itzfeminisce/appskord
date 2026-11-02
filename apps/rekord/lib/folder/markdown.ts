// Rekord folder layout: pure Markdown with front matter, documented so other tools can rely on it.
//   Meetings/<YYYY-MM-DD> <title> (<id>).md   one per meeting; <id> is a short id suffix, so names never collide
//   People/<name> (<id>).md                   one per person
//   Open loops.md                      open promises and questions
//   Decisions.md                       every decision, replaced ones struck through
import type { Marker, Meeting, Note, Segment } from '../types';
import type { MemoryItem, Person } from '../memory/types';

/** `key` names the meeting or person a file belongs to, so the writer can delete its old file when the name changes. */
export interface FolderFile { path: string; text: string; key?: string }
export interface MeetingParts { meeting: Meeting; segments: Segment[]; notes: Note[]; markers: Marker[]; items: MemoryItem[] }

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const hhmm = (ms: number) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const clock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

// Windows forbids these in file names; ':' becomes the look-alike ratio sign so "1:1" still reads as "1:1".
export function safeName(name: string): string {
  const clean = name.replace(/:/g, '∶').replace(/[<>"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return clean.slice(0, 120) || 'Untitled';
}

export const shortId = (id: string) => id.replace(/[^a-z0-9]/gi, '').slice(-6) || '0';
export const meetingPath = (m: Pick<Meeting, 'id' | 'title' | 'startedAt'>) => `Meetings/${isoDay(m.startedAt)} ${safeName(m.title)} (${shortId(m.id)}).md`;
export const personPath = (p: Pick<Person, 'name'>) => `People/${safeName(p.name)}.md`;
export const meetingKey = (id: string) => `m:${id}`;
export const personKey = (id: string) => `p:${id}`;
export const OPEN_LOOPS_PATH = 'Open loops.md';
export const DECISIONS_PATH = 'Decisions.md';
const link = (path: string) => `[[${path.replace(/\.md$/, '')}]]`;

function frontMatter(fields: Record<string, string | number | string[] | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'number' ? v : JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

type People = Map<string, Person>;
const nameOf = (people: People, id?: string) => (id === 'me' ? 'You' : id ? people.get(id)?.name : undefined);

function itemLine(item: MemoryItem, people: People, meetings?: Map<string, Meeting>): string {
  const done = item.status === 'done' || item.status === 'answered';
  const box = item.kind === 'decision' ? '' : done ? '[x] ' : '[ ] ';
  const text = item.status === 'replaced' ? `~~${item.text}~~ (replaced)` : item.text;
  const owner = nameOf(people, item.ownerId);
  const to = nameOf(people, item.toId);
  const parts = [`${box}${text}`];
  if (owner || to) parts.push([owner, to].filter(Boolean).join(' → '));
  if (item.due) parts.push(`due ${item.due}`);
  const source = meetings?.get(item.meetingId);
  if (source) parts.push(link(meetingPath(source)));
  const quote = `  > “${item.quote.text}” (${item.quote.speaker}, ${clock(item.quote.atMs)})`;
  return `- ${parts.join(' · ')}\n${quote}`;
}

const section = (heading: string, lines: string[]) => (lines.length ? `\n## ${heading}\n\n${lines.join('\n')}\n` : '');
const visible = (i: MemoryItem) => !i.leftOut && i.status !== 'dismissed' && i.status !== 'suggested';

export function meetingMarkdown({ meeting, segments, notes, markers, items }: MeetingParts, people: People): string {
  const names = [...new Set(items.flatMap((i) => i.personIds).map((id) => people.get(id)?.name).filter((n): n is string => !!n))];
  const kept = items.filter(visible);
  const speaker = (s: Segment) => (s.speakerLabel && meeting.speakers?.[s.speakerLabel]?.name) || (s.speaker === 'you' ? 'You' : 'Others');
  const summary = meeting.summary;
  return [
    frontMatter({
      id: meeting.id, title: meeting.title, date: isoDay(meeting.startedAt), start: hhmm(meeting.startedAt),
      end: meeting.endedAt ? hhmm(meeting.endedAt) : undefined, people: names, source: 'rekord',
    }),
    `\n# ${meeting.title}\n`,
    section('Summary', summary?.overview ? [summary.overview] : []),
    section('Promises', kept.filter((i) => i.kind === 'promise').map((i) => itemLine(i, people))),
    section('Decisions', kept.filter((i) => i.kind === 'decision').map((i) => itemLine(i, people))),
    section('Questions', kept.filter((i) => i.kind === 'question').map((i) => itemLine(i, people))),
    section('Notes', [...notes.map((n) => ({ atMs: n.atMs, text: n.text })), ...markers.filter((m) => m.label).map((m) => ({ atMs: m.atMs, text: m.label! }))]
      .sort((a, b) => a.atMs - b.atMs).map((n) => `- ${clock(n.atMs)} ${n.text}`)),
    section('Transcript', segments.filter((s) => !s.interim).map((s) => `**${speaker(s)}** ${clock(s.startMs)} ${s.text}`)),
  ].join('');
}

export function personMarkdown(person: Person, items: MemoryItem[], meetings: Map<string, Meeting>, people: People): string {
  const mine = items.filter((i) => visible(i) && i.personIds.includes(person.id));
  const open = mine.filter((i) => i.kind === 'promise' && (i.status === 'open' || i.status === 'looksDone'));
  const met = person.meetingIds.map((id) => meetings.get(id)).filter((m): m is Meeting => !!m).sort((a, b) => b.startedAt - a.startedAt);
  return [
    frontMatter({ id: person.id, name: person.name, email: person.email, company: person.company, meetings: met.length }),
    `\n# ${person.name}\n`,
    section('Open promises', open.map((i) => itemLine(i, people, meetings))),
    section('Decisions', mine.filter((i) => i.kind === 'decision').map((i) => itemLine(i, people, meetings))),
    section('Meetings', met.map((m) => `- ${link(meetingPath(m))}`)),
  ].join('');
}

export function openLoopsMarkdown(items: MemoryItem[], meetings: Map<string, Meeting>, people: People): string {
  const open = items.filter((i) => visible(i) && (i.status === 'open' || i.status === 'looksDone') && i.kind !== 'decision');
  const byDue = (a: MemoryItem, b: MemoryItem) => (a.due ?? '9999').localeCompare(b.due ?? '9999');
  return [
    frontMatter({ title: 'Open loops', source: 'rekord' }),
    '\n# Open loops\n',
    section('Promises', open.filter((i) => i.kind === 'promise').sort(byDue).map((i) => itemLine(i, people, meetings))),
    section('Questions', open.filter((i) => i.kind === 'question').map((i) => itemLine(i, people, meetings))),
  ].join('');
}

export function decisionsMarkdown(items: MemoryItem[], meetings: Map<string, Meeting>, people: People): string {
  const decisions = items.filter((i) => visible(i) && i.kind === 'decision').sort((a, b) => b.createdAt - a.createdAt);
  return [frontMatter({ title: 'Decisions', source: 'rekord' }), '\n# Decisions\n', section('Decisions', decisions.map((i) => itemLine(i, people, meetings)))].join('');
}

/** Every file for the given meetings, plus the people pages and the two lists, which are always rewritten whole. */
export function folderFiles(parts: MeetingParts[], all: { meetings: Meeting[]; people: Person[]; items: MemoryItem[] }): FolderFile[] {
  const people: People = new Map(all.people.map((p) => [p.id, p]));
  const meetings = new Map(all.meetings.map((m) => [m.id, m]));
  return [
    ...parts.map((p) => ({ path: meetingPath(p.meeting), text: meetingMarkdown(p, people), key: meetingKey(p.meeting.id) })),
    ...all.people.map((p) => ({ path: personPath(p), text: personMarkdown(p, all.items, meetings, people), key: personKey(p.id) })),
    { path: OPEN_LOOPS_PATH, text: openLoopsMarkdown(all.items, meetings, people) },
    { path: DECISIONS_PATH, text: decisionsMarkdown(all.items, meetings, people) },
  ];
}
