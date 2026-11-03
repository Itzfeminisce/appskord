/** The follow-up email: facts from the meeting's memory, a plain draft, and the AI's wording of it in the user's voice. */
import { record as recordCall } from '../ledger';
import { chat, LLMError, type ChatOptions, type FetchLike } from '../llm';
import { getSettings } from '../settings';
import type { LedgerEntry, MemoryItem, Person } from '../memory/types';
import type { CalendarEvent, Meeting } from '../types';
import { promiseOrder } from './order';

export type FollowUpLength = 'short' | 'full';
export interface Recipient { name: string; email: string }

export interface FollowUpFacts {
  meetingId: string;
  /** The user's first name from the invite, for the sign-off. */
  me?: string;
  recipients: Recipient[];
  subject: string;
  /** "Northwind rollout starts 16 Nov (was 9 Nov)." */
  decisions: string[];
  /** "Alex: Send the revised pricing deck, today" */
  owes: string[];
  /** "Tue 10 Nov, 10:00" */
  next?: string;
  overview?: string;
  /** From a catch-up: the email says the notes are the user's own account. */
  catchup?: true;
}

/** The follow-up email line for a catch-up (FRAMES V41Items). */
export const CATCHUP_EMAIL_LINE = 'These notes are from my own catch-up after the meeting, so tell me if I got anything wrong.';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayOf = (d: Date) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fromIso = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y!, m! - 1, d!); };
/** "Thu 5 Nov". */
export const dayLabel = (iso: string) => dayOf(fromIso(iso));
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const WEEK = 7 * 24 * 60 * 60_000;

const live = (i: MemoryItem) => !i.leftOut && !['dismissed', 'dropped', 'replaced'].includes(i.status);

/** "16 Nov (was 9 Nov)": the old decision's words after what both texts share. */
function decisionLine(item: MemoryItem, old?: MemoryItem): string {
  if (!old) return `${item.text}.`;
  const a = item.text.split(/\s+/);
  const b = old.text.split(/\s+/);
  let same = 0;
  while (same < a.length && same < b.length && a[same]!.toLowerCase() === b[same]!.toLowerCase()) same++;
  const was = same > 0 && same < b.length ? b.slice(same).join(' ') : old.text;
  return `${item.text} (was ${was}).`;
}

/** The next meeting with the same people: a later calendar event, else one week on in their series. */
function nextMeeting(meeting: Meeting, recipients: Recipient[], people: Person[], events: CalendarEvent[]): number | undefined {
  const emails = new Set(recipients.map((r) => r.email.toLowerCase()));
  const after = meeting.endedAt ?? meeting.startedAt;
  const event = events
    .filter((e) => e.start > after && e.id !== meeting.event?.id && e.attendees.some((a) => emails.has(a.email.toLowerCase())))
    .sort((x, y) => x.start - y.start)[0];
  if (event) return event.start;
  const start = new Date(meeting.startedAt);
  const slot = `Every ${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(start)} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const inSeries = people.some((p) => p.email && emails.has(p.email.toLowerCase()) && p.series?.label === slot);
  return inSeries ? meeting.startedAt + WEEK : undefined;
}

/** Everything the email says, from the meeting and its memory items. Pure. */
export function followUpFacts(
  meeting: Meeting, items: MemoryItem[], people: Person[],
  opts: { now: number; events?: CalendarEvent[]; earlier?: MemoryItem[] },
): FollowUpFacts {
  const attendees = meeting.event?.attendees ?? [];
  const self = attendees.find((a) => a.self);
  const recipients = attendees.filter((a) => !a.self && a.email).map((a) => ({ name: a.name?.trim() || a.email, email: a.email }));
  const nameOf = (id?: string) => people.find((p) => p.id === id)?.name;
  const me = self?.name ? firstName(self.name) : undefined;
  const mine = items.filter((i) => live(i) && i.meetingId === meeting.id);
  const byId = new Map([...(opts.earlier ?? []), ...items].map((i) => [i.id, i]));
  const today = isoDay(opts.now);

  const decisions = mine.filter((i) => i.kind === 'decision').map((i) => decisionLine(i, i.replacesId ? byId.get(i.replacesId) : undefined));
  const owes = mine.filter((i) => i.kind === 'promise' && i.ownerId).sort(promiseOrder).map((i) => {
    const yours = i.ownerId === 'me';
    const owner = yours ? (me ?? 'Me') : firstName(nameOf(i.ownerId) ?? '');
    const when = !i.due ? 'no date yet' : yours ? (i.due === today ? 'today' : dayLabel(i.due)) : `by ${dayLabel(i.due)}`;
    return `${owner}: ${i.text}, ${when}`;
  });
  const next = nextMeeting(meeting, recipients, people, opts.events ?? []);
  const d = next === undefined ? undefined : new Date(next);
  return {
    meetingId: meeting.id,
    ...(me ? { me } : {}),
    recipients,
    subject: `Notes from ${meeting.title}, ${dayOf(new Date(meeting.startedAt))}`,
    decisions: decisions.slice(0, MAX_LIST),
    owes: owes.slice(0, MAX_LIST),
    ...(d ? { next: `${dayOf(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}` } : {}),
    ...(meeting.summary?.overview ? { overview: meeting.summary.overview } : {}),
    ...(meeting.source === 'catchup' ? { catchup: true as const } : {}),
  };
}

/** "Hi Sarah and Tom,". */
export function greeting(recipients: Recipient[]): string {
  const names = recipients.map((r) => firstName(r.name));
  if (names.length === 0) return 'Hi,';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `Hi ${list},`;
}

/** The email without the AI: the facts in the frame's layout. The AI rewords this; it is also the fallback. */
export function plainDraft(f: FollowUpFacts, length: FollowUpLength): string {
  const parts = [greeting(f.recipients), 'Thanks for today.', ...(f.catchup ? [CATCHUP_EMAIL_LINE] : [])];
  if (length === 'full') {
    if (f.decisions.length) parts.push(['Decided', ...f.decisions.map((x) => `- ${x}`)].join('\n'));
    if (f.owes.length) parts.push(['Who owes what', ...f.owes.map((x) => `- ${x}`)].join('\n'));
  } else if (f.owes.length) {
    parts.push(f.owes.map((x) => `- ${x}`).join('\n'));
  }
  if (f.next) parts.push(`Next meeting: ${f.next}.`);
  if (f.me) parts.push(f.me);
  return parts.join('\n\n');
}

/** Longest decision or owes list in a follow-up. */
const MAX_LIST = 30;
export const FOLLOW_UP_LEDGER_WHAT = 'Meeting notes for a follow-up email';
const LEDGER_SERVICE: Partial<Record<string, LedgerEntry['service']>> = { groq: 'groq', openai: 'openai', openrouter: 'openrouter', anthropic: 'anthropic' };
const NOT_SENT = new Set(['no-key', 'offline', 'local-unavailable', 'cancelled']);
const OVERVIEW_CHARS = 1500;

export function followUpMessages(f: FollowUpFacts, length: FollowUpLength) {
  const shape = length === 'full'
    ? 'Full: thanks, what was decided, who owes what by when, and the next meeting, under the same headings.'
    : 'Short: two or three sentences of thanks, then who owes what as a short list.';
  return [
    {
      role: 'system' as const,
      content: 'You write the follow-up email a person sends after their meeting, in their own voice: plain, warm and brief. '
        + 'Use only the facts given. Never add a promise, date, name or decision. Reply with the email body only, no subject line.',
    },
    {
      role: 'user' as const,
      content: `Length: ${shape}\n\nReword this draft lightly. Keep every fact, date and name exactly${f.catchup ? ', and keep the line about my catch-up word for word' : ''}:\n\n${plainDraft(f, length)}`
        + (f.overview ? `\n\nMeeting summary, for context only:\n${f.overview.slice(0, OVERVIEW_CHARS)}` : ''),
    },
  ];
}

export interface FollowUpDeps {
  fetch?: FetchLike;
  config?: ChatOptions['config'];
  record?: typeof recordCall;
  signal?: AbortSignal;
}

/** The AI may reword or drop the catch-up line; it goes back in word for word, after the opening paragraph. */
export function withCatchupLine(body: string): string {
  if (body.includes(CATCHUP_EMAIL_LINE)) return body;
  const paras = body.split(/\n{2,}/);
  const at = Math.min(2, paras.length);
  return [...paras.slice(0, at), CATCHUP_EMAIL_LINE, ...paras.slice(at)].join('\n\n');
}

/** The AI's draft of the email. Throws LLMError; records one ledger entry when the text was sent. */
export async function draftFollowUp(f: FollowUpFacts, length: FollowUpLength, deps: FollowUpDeps = {}): Promise<string> {
  const service = LEDGER_SERVICE[(deps.config?.settings ?? (await getSettings())).summary.provider];
  let sent = true;
  try {
    const reply = (await chat(followUpMessages(f, length), { temperature: 0.3, maxTokens: 700, signal: deps.signal, config: deps.config }, deps.fetch)).trim();
    if (!reply) throw new LLMError('The AI service sent an unexpected reply. Try again.', 'bad-reply');
    return f.catchup ? withCatchupLine(reply) : reply;
  } catch (e) {
    sent = !(e instanceof LLMError && NOT_SENT.has(e.code));
    throw e;
  } finally {
    if (service && sent) await (deps.record ?? recordCall)({ meetingId: f.meetingId, service, what: FOLLOW_UP_LEDGER_WHAT });
  }
}

export const GMAIL_LEDGER_WHAT = 'Follow-up email, opened in Gmail';
