// The reminder email for a promise owed to you, drafted by the AI from the promise's quote.
import { record } from '../ledger';
import { chat, LLMError, type ChatMessage, type FetchLike } from '../llm';
import { getSettings } from '../settings';
import type { LedgerEntry, MemoryItem } from './types';

export type NudgeTone = 'friendly' | 'short' | 'firm';
export const NUDGE_TONES: NudgeTone[] = ['friendly', 'short', 'firm'];

export interface NudgeInput {
  item: MemoryItem;
  /** Who owes it: first name for the greeting. */
  toName: string;
  /** The user's name for the sign-off, when Rekord knows it. */
  me?: string;
  /** "1:1 with Sarah · 27 Oct", where the promise was made. */
  madeIn: string;
  /** "today at 10:00", when the next meeting with them is on the calendar. */
  nextMeeting?: string;
  /** "due today", "4 days late" or missing. */
  due?: string;
  tone: NudgeTone;
}

export const NUDGE_LEDGER_WHAT = 'Quote for a reminder draft';

const TONE: Record<NudgeTone, string> = {
  friendly: 'Warm and polite, 2 or 3 short sentences.',
  short: 'One or two sentences, no small talk.',
  firm: 'Polite but direct: say clearly that you need it and by when. 2 or 3 sentences.',
};

const SYSTEM = [
  'You write a short reminder email asking someone for something they promised in a meeting.',
  'Write only the email body: a greeting with their first name, the ask, and a sign-off. No subject line, no placeholders, no quotes around it.',
  'Use only the facts given. Do not invent dates, numbers or reasons.',
].join(' ');

/** The chat messages for one draft. Only the promise, its quote and dates are sent. */
export function nudgeMessages(input: NudgeInput): ChatMessage[] {
  const { item } = input;
  const lines = [
    `Recipient: ${input.toName}`,
    `What they promised: ${item.text}`,
    `What they said: ${item.quote.speaker}: “${item.quote.text}” (${input.madeIn})`,
    input.due ? `Status: ${input.due}` : undefined,
    input.nextMeeting ? `Our next meeting: ${input.nextMeeting}` : undefined,
    input.me ? `Sign off as: ${input.me}` : 'Sign off without a name.',
    `Tone: ${TONE[input.tone]}`,
  ].filter(Boolean);
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: lines.join('\n') }];
}

/** Drops a subject line or wrapping quotes the model added anyway, and joins sign-off lines with spaces. */
export function cleanDraft(raw: string): string {
  return raw
    .replace(/^\s*subject:.*$/im, '')
    .trim()
    .replace(/^["“](.*)["”]$/s, '$1')
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
}

// Ollama runs on the person's computer, so nothing leaves it and nothing is recorded.
const LEDGER_SERVICE: Partial<Record<string, LedgerEntry['service']>> = { groq: 'groq', openai: 'openai', openrouter: 'openrouter', anthropic: 'anthropic' };
// These failures happen before any text leaves the browser.
const NOT_SENT = new Set(['no-key', 'offline', 'local-unavailable', 'cancelled']);

/** Asks the AI for a draft and records the call in the ledger. Throws LLMError. */
export async function draftNudge(input: NudgeInput, deps: { fetchFn?: FetchLike } = {}): Promise<string> {
  const service = LEDGER_SERVICE[(await getSettings()).summary.provider];
  let sent = true;
  try {
    return cleanDraft(await chat(nudgeMessages(input), { maxTokens: 300, temperature: 0.5 }, deps.fetchFn));
  } catch (error) {
    sent = !(error instanceof LLMError && NOT_SENT.has(error.code));
    throw error;
  } finally {
    if (service && sent) await record({ meetingId: input.item.meetingId, service, what: NUDGE_LEDGER_WHAT });
  }
}
