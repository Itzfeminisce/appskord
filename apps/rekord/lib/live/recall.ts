// Recall card: the live loop looks up memory for what is being said and words a card from stored text. No AI call.
import { queryWords, shortDate, type MeetingData } from '../askAll';
import { topicOf } from '../memory/agenda';
import type { MemoryItem, Person } from '../memory/types';
import type { SearchResult } from '../recall';
import { scoreItem } from '../recall/search';
import type { Meeting, Segment } from '../types';

/** At most one recall card every 2 minutes. */
export const RECALL_GAP_MS = 2 * 60_000;
/** What was said in the last minute is the query. */
export const RECALL_WINDOW_MS = 60_000;
// Keyword hits need two words in the item text (or one there and two in its quote).
const MIN_KEYWORD = 4;

export interface RecallGate { muted: boolean; lastShownAt?: number; showing: boolean }

/** A new card may show: recall not muted, no card up, and 2 minutes since the last one. */
export function recallAllowed(gate: RecallGate, now: number): boolean {
  if (gate.muted || gate.showing) return false;
  return gate.lastShownAt === undefined || now - gate.lastShownAt >= RECALL_GAP_MS;
}

export interface RecallCard { text: string; itemIds: string[]; meetingId: string; atMs: number }

/** Items recall may bring back: open promises and decisions still in force, from other meetings. */
export function recallable(item: MemoryItem, meetingId: string): boolean {
  if (item.meetingId === meetingId || item.leftOut) return false;
  if (item.kind === 'decision') return item.status === 'open';
  return item.kind === 'promise' && (item.status === 'open' || item.status === 'looksDone');
}

/** The last minute of the transcript, as one query. */
export function recentText(segments: Segment[], nowMs: number, windowMs = RECALL_WINDOW_MS): string {
  return segments.filter((s) => !s.interim && s.text.trim() && s.endMs >= nowMs - windowMs && s.startMs <= nowMs).map((s) => s.text.trim()).join(' ');
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getTime(); };

/** "Team plan is $12 a seat" → "$12 a seat"; other texts as they are. */
export function decisionGist(text: string): string {
  const at = text.indexOf(' is ');
  return at > 0 ? text.slice(at + 4).trim() : text.trim();
}

/** "Q3 usage numbers" → "the Q3 usage numbers"; "Revised pricing deck" → "the revised pricing deck". */
function theThing(text: string): string {
  const t = topicOf(text);
  const keepCase = /^.[A-Z0-9]/.test(t);
  return `the ${keepCase ? t : t.charAt(0).toLowerCase() + t.slice(1)}`;
}

function dueText(due: string | undefined, now: number): string {
  if (!due) return '';
  return due === isoDay(now) ? ', due today' : `, due ${shortDate(fromIso(due))}`;
}

const first = (name: string | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** One sentence per item: "On 26 Oct you decided $12 a seat." / "Sarah owed the Q3 numbers, due today." */
export function recallSentence(item: MemoryItem, meetingStart: number, people: Map<string, Person>, now: number): string | undefined {
  if (item.kind === 'decision') return `On ${shortDate(meetingStart)} you decided ${decisionGist(item.text)}.`;
  if (item.kind !== 'promise') return undefined;
  if (item.ownerId === 'me') {
    const to = first(people.get(item.toId ?? '')?.name);
    return to ? `You owe ${to} ${theThing(item.text)}${dueText(item.due, now)}.` : undefined;
  }
  const owner = first(people.get(item.ownerId ?? '')?.name);
  return owner ? `${owner} owed ${theThing(item.text)}${dueText(item.due, now)}.` : undefined;
}

/** Up to one decision and one promise, in search order, as the card. */
export function recallCard(items: MemoryItem[], meetings: Pick<Meeting, 'id' | 'startedAt'>[], people: Person[], now: number): RecallCard | undefined {
  const starts = new Map(meetings.map((m) => [m.id, m.startedAt]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const decision = items.find((i) => i.kind === 'decision');
  const promise = items.find((i) => i.kind === 'promise');
  const picked = [decision, promise].filter((i): i is MemoryItem => !!i);
  const parts = picked
    .map((i) => ({ i, s: recallSentence(i, starts.get(i.quote.meetingId) ?? i.createdAt, byId, now) }))
    .filter((x): x is { i: MemoryItem; s: string } => !!x.s);
  const lead = parts[0];
  if (!lead) return undefined;
  return { text: parts.map((p) => p.s).join(' '), itemIds: parts.map((p) => p.i.id), meetingId: lead.i.quote.meetingId, atMs: lead.i.quote.atMs };
}

/** Search hits worth a card: a clear keyword match, or a top meaning match when the search model is loaded. */
export function strongHits(result: SearchResult, query: string, seen: Set<string>): MemoryItem[] {
  if (!queryWords(query).length) return [];
  return result.items
    .filter(({ item }, rank) => !seen.has(item.id) && (scoreItem(item, query) >= MIN_KEYWORD || (result.mode === 'hybrid' && rank < 2)))
    .map(({ item }) => item);
}

const lightLoad = async (meeting: Meeting): Promise<MeetingData> => ({ meeting, segments: [], notes: [] });

export interface RecallDeps {
  search: (query: string, opts: { meetings: Meeting[]; limit: number; itemFilter: (i: MemoryItem) => boolean; load: (m: Meeting) => Promise<MeetingData> }) => Promise<SearchResult>;
  meetings: Meeting[];
  people: Person[];
  now: number;
}

/** One recall lookup for the live tick; undefined when nothing clear came up. Keyword-only without a search model. */
export async function findRecall(meetingId: string, query: string, seen: Set<string>, deps: RecallDeps): Promise<RecallCard | undefined> {
  if (!query.trim()) return undefined;
  const meetings = deps.meetings.filter((m) => m.id !== meetingId && m.status === 'done');
  // The card is built from items only: no meeting's transcript is loaded on the live tick.
  const result = await deps.search(query, { meetings, limit: 6, itemFilter: (i) => recallable(i, meetingId), load: lightLoad });
  return recallCard(strongHits(result, query, seen), meetings, deps.people, deps.now);
}
