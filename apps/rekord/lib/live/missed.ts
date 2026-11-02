// "What did I miss?": the last few minutes in three lines, plus anything asked of you. One AI call, one ledger entry.
import { record as recordCall } from '../ledger';
import { chat, LLMError, transcriptLines, type ChatOptions, type FetchLike } from '../llm';
import type { LedgerEntry } from '../memory/types';
import { getSettings } from '../settings';
import type { Meeting, Segment } from '../types';

export const MISSED_MINUTES = [2, 3, 5] as const;
export type MissedMinutes = (typeof MISSED_MINUTES)[number];
export const MISSED_LEDGER_WHAT = 'Ask and What did I miss?';
// Lines past this many characters are dropped from the oldest, to stay well under the token budget.
const MAX_CHARS = 12_000;

export const MISSED_SYSTEM = [
  'You catch someone up on a live meeting they lost track of. The user is "You" in the transcript.',
  'Reply with ONLY a JSON object: {"lines": [{"atMs": number, "text": string}], "forYou": string | null}.',
  '"lines" is exactly three short plain sentences, oldest first, each with the time of the line it comes from in milliseconds, matching its [m:ss] stamp.',
  '"forYou" is one sentence on anything asked of or promised to the user, or null when there is nothing. Write in the language of the meeting.',
].join('\n');

export interface MissedLine { atMs: number; text: string }
export interface Missed { lines: MissedLine[]; forYou?: string }

function toMs(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const m = typeof v === 'string' ? /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(v.trim()) : null;
  return m ? (Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 : undefined;
}

/** Reads the model's reply; tolerates code fences and prose around the object. */
export function parseMissed(raw: string): Missed | undefined {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  let data: unknown;
  try { data = JSON.parse(raw.slice(a, b + 1)); } catch { return undefined; }
  const o = data as { lines?: unknown; forYou?: unknown };
  if (!Array.isArray(o.lines)) return undefined;
  const lines: MissedLine[] = [];
  for (const l of o.lines) {
    const x = l as { atMs?: unknown; text?: unknown };
    const text = typeof x?.text === 'string' ? x.text.trim() : '';
    const atMs = toMs(x?.atMs);
    if (text && atMs !== undefined) lines.push({ atMs, text });
  }
  if (!lines.length) return undefined;
  const forYou = typeof o.forYou === 'string' && o.forYou.trim() ? o.forYou.trim().replace(/^[“"]|[”"]$/g, '') : undefined;
  return { lines: lines.slice(0, 3), ...(forYou ? { forYou } : {}) };
}

/** The transcript of the last `minutes` before `nowMs`, newest lines kept when it is long. */
export function missedWindow(segments: Segment[], minutes: number, nowMs: number): Segment[] {
  const from = nowMs - minutes * 60_000;
  const recent = segments.filter((s) => !s.interim && s.text.trim() && s.endMs >= from && s.startMs <= nowMs);
  let chars = 0;
  const kept: Segment[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    chars += recent[i]!.text.length;
    if (chars > MAX_CHARS) break;
    kept.unshift(recent[i]!);
  }
  return kept;
}

const LEDGER_SERVICE: Partial<Record<string, LedgerEntry['service']>> = { groq: 'groq', openai: 'openai', openrouter: 'openrouter', anthropic: 'anthropic' };
const NOT_SENT = new Set(['no-key', 'offline', 'local-unavailable', 'cancelled']);

export interface LiveAiDeps {
  fetch?: FetchLike;
  config?: ChatOptions['config'];
  signal?: AbortSignal;
  record?: typeof recordCall;
}

/** Runs one chat call and records it in the ledger when it left this computer. */
export async function liveChat(meetingId: string, what: string, system: string, user: string, deps: LiveAiDeps, maxTokens: number): Promise<string> {
  const service = LEDGER_SERVICE[(deps.config?.settings ?? (await getSettings())).summary.provider];
  let sent = true;
  try {
    return await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { json: true, maxTokens, temperature: 0.2, signal: deps.signal, config: deps.config }, deps.fetch);
  } catch (e) {
    sent = !(e instanceof LLMError && NOT_SENT.has(e.code));
    throw e;
  } finally {
    if (service && sent) await (deps.record ?? recordCall)({ meetingId, service, what });
  }
}

export type MissedResult = { status: 'ok'; missed: Missed } | { status: 'none' } | { status: 'error'; error: string };

/** Never throws: errors land on the result. */
export async function whatDidIMiss(meeting: Pick<Meeting, 'id' | 'speakers'>, segments: Segment[], minutes: MissedMinutes, nowMs: number, deps: LiveAiDeps = {}): Promise<MissedResult> {
  const window = missedWindow(segments, minutes, nowMs);
  if (!window.length) return { status: 'none' };
  try {
    const user = [`Transcript (last ${minutes} minutes):`, ...transcriptLines(window, meeting.speakers)].join('\n');
    const missed = parseMissed(await liveChat(meeting.id, MISSED_LEDGER_WHAT, MISSED_SYSTEM, user, deps, 400));
    if (!missed) throw new LLMError('The AI service sent an unexpected reply. Try again.', 'bad-reply');
    return { status: 'ok', missed };
  } catch (e) {
    return { status: 'error', error: e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.' };
  }
}
