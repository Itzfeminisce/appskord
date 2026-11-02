// Pure parts of the "Catch up" machine checks: prompts, matching, Go or No-go. The page measures, this decides.
import { CATCHUP_PROMPTS, cover } from '@/lib/catchup/coverage';
import { LINE_MS, type Telling } from '@/lib/catchup/fixtures';
import { catchupPreamble } from '@/lib/catchup/preamble';
import type { CatchupPrompt } from '@/lib/catchup/types';
import { LLMError, transcriptLines } from '@/lib/llm';
import { buildExtractPrompt, EXTRACT_SYSTEM, parseExtraction, splitParts, type RawItem } from '@/lib/memory/extract';
import { isoDay } from '@/lib/memory/rank';
import type { Segment } from '@/lib/types';

export type CatchupCheckId = 'mic' | 'extract' | 'coverage';
export type Verdict = 'go' | 'no-go';
export interface CatchupResult { id: CatchupCheckId; verdict?: Verdict; value: string; note?: string }

export const CATCHUP_CHECKS: { id: CatchupCheckId; label: string; target: string; fallback: string }[] = [
  { id: 'mic', label: 'Mic-only start, no tab and no tab grant', target: 'records and transcribes', fallback: 'Start from a Rekord tab page instead of the side panel' },
  { id: 'extract', label: 'Owners and due dates from three tellings', target: 'at least 9 of 10', fallback: 'A stronger instruction, or ask a follow-up question for every unclear owner' },
  { id: 'coverage', label: 'Prompt ticks while talking', target: 'under 15 s', fallback: 'Prompts stay as a static list with no ticks' },
];
export const EXTRACT_GO_AT = 9;
export const COVERAGE_LIMIT_MS = 15_000;
export const COVERAGE_STEP_MS = 5_000;
export const MIC_SECONDS = 10;

/** Takes anything that looks like a key or token out of text that may reach the screen or the clipboard. */
export function scrub(text: string, secrets: readonly string[] = []): string {
  return secrets.filter((k) => k.length >= 6).reduce((t, k) => t.split(k).join('[hidden]'), text)
    .replace(/access_token=[^&\s]+/gi, 'access_token=[hidden]')
    .replace(/\b(Bearer|Token|Authorization:?|api[_-]?key[=:]?)\s*[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [hidden]')
    .replace(/\b(?:gsk|sk|pk|xai|ya29|dg)[-_.][A-Za-z0-9._-]{6,}/g, '[hidden]')
    .replace(/\bAIza[A-Za-z0-9_-]{6,}/g, '[hidden]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[hidden]')
    .slice(0, 200);
}

export const tellingSegments = (t: Telling, meetingId: string): Segment[] =>
  t.lines.map((text, i) => ({ id: `${meetingId}:${i}`, meetingId, speaker: 'you', startMs: i * LINE_MS, endMs: i * LINE_MS + LINE_MS - 1_000, text, chunkId: 'check' }));

/** The v4 extraction system prompt with T1's catch-up preamble in front, built here so lib/memory/extract.ts stays as it is. */
export const catchupSystem = (startedAt: number): string => `${catchupPreamble(startedAt)}\n${EXTRACT_SYSTEM}`;

/** One user message per part of the telling, as the v4 extraction would send them. */
export function extractUsers(t: Telling): string[] {
  return splitParts(tellingSegments(t, t.id)).map((part) =>
    buildExtractPrompt({ title: t.title, date: isoDay(t.startedAt), lines: transcriptLines(part.segments), open: [], notPromises: [] }));
}

const first = (name: string) => name.trim().toLowerCase().split(/\s+/)[0] ?? '';

/** The sheet gives a first name; a full name from the model counts when its first token matches. */
const sameOwner = (given: string, sheetOwner: string) => first(given) === first(sheetOwner);

/** How many sheet entries have a promise with that owner and that due date. */
export function matchSheet(sheet: Telling['sheet'], found: Pick<RawItem, 'kind' | 'owner' | 'due'>[]): number {
  const promises = found.filter((i) => i.kind === 'promise' && i.owner);
  return sheet.filter((s) => promises.some((p) => sameOwner(p.owner!, s.owner) && p.due === s.due)).length;
}

/** Items from the replies of every part; a reply that is not JSON adds none. */
export const itemsFrom = (replies: string[]): RawItem[] => replies.flatMap((r) => parseExtraction(r).items);

export const scoreExtraction = (matched: number, total: number): Verdict => (total > 0 && matched >= Math.min(EXTRACT_GO_AT, total) && matched / total >= 0.9 ? 'go' : 'no-go');

/** Feeds the telling in 5-second steps; for each prompt, the time from the covering line to the step that shows it. */
export function coverageDelays(t: Telling, stepMs = COVERAGE_STEP_MS): Partial<Record<CatchupPrompt, number>> {
  const all = tellingSegments(t, t.id);
  const end = all.at(-1)!.endMs + stepMs;
  const delays: Partial<Record<CatchupPrompt, number>> = {};
  for (let at = stepMs; at <= end; at += stepMs) {
    const heard = all.filter((s) => s.endMs <= at);
    for (const c of cover(heard)) {
      if (c.coveredAtMs !== undefined && delays[c.prompt] === undefined) delays[c.prompt] = at - c.coveredAtMs;
    }
  }
  return delays;
}

/** Go when every prompt gets a tick and the slowest, plus the measured mic time to first text if it ran, is under 15 s. The simulated feed has no transcription lag, so that is added from the mic check. */
export function scoreCoverage(delays: Partial<Record<CatchupPrompt, number>>[], transcribeMs = 0): { verdict: Verdict; worstMs?: number } {
  const all = delays.flatMap((d) => CATCHUP_PROMPTS.map((p) => d[p]));
  if (!all.length || all.some((x) => x === undefined)) return { verdict: 'no-go' };
  const worstMs = Math.max(...(all as number[])) + Math.max(0, transcribeMs);
  return { verdict: worstMs < COVERAGE_LIMIT_MS ? 'go' : 'no-go', worstMs };
}

/** The text X pastes back for the Catch up section: Go or No-go and the fallback for each; never a key. */
export function catchupText(results: CatchupResult[]): string {
  const by = new Map(results.map((r) => [r.id, r]));
  const lines = CATCHUP_CHECKS.map((c) => {
    const r = by.get(c.id);
    const mark = r ? (r.verdict === 'go' ? 'Go' : r.verdict === 'no-go' ? 'No-go' : 'Info') : 'Not run';
    const fallback = r?.verdict === 'no-go' ? ` Fallback: ${c.fallback}.` : '';
    return scrub(`Catch up: ${c.label}: ${r?.value ?? '-'} (target ${c.target}) ${mark}${r?.note ? ` - ${r.note}` : ''}.${fallback}`);
  });
  return lines.join('\n');
}

export const LIMIT_RETRIES = 3;
export const LIMIT_DEFAULT_WAIT_S = 60;
export const LIMIT_MAX_WAIT_S = 120;
export const TELLING_PAUSE_S = 20;

/** Seconds to wait after an AI rate limit (the provider's retry-after if it sent one, else 60), or undefined for any other error. */
export function limitWaitSecs(e: unknown): number | undefined {
  if (!(e instanceof LLMError) || e.code !== 'rate-limited') return undefined;
  const s = e.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : LIMIT_DEFAULT_WAIT_S;
  return Math.min(LIMIT_MAX_WAIT_S, Math.max(5, s));
}
