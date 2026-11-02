// Clash: a line that may change an earlier decision. A local check picks candidates; the AI only confirms and words it.
import { queryWords } from '../askAll';
import type { MemoryItem } from '../memory/types';
import type { Segment } from '../types';
import { liveChat, type LiveAiDeps } from './missed';

export const CLASH_LEDGER_WHAT = 'Clash checks';
const CHANGE = /\b(move|moving|moved|change|changing|instead|push|pushed|delay|postpone|switch|rather|no longer|not anymore|actually|cancel|drop)\b/i;

export interface ClashCandidate { decision: MemoryItem; segment: Segment }

/** Lines that share a word with an open decision and talk about changing something. */
export function clashCandidates(decisions: MemoryItem[], segments: Segment[]): ClashCandidate[] {
  const open = decisions.filter((d) => d.kind === 'decision' && d.status === 'open' && !d.leftOut);
  const out: ClashCandidate[] = [];
  for (const segment of segments) {
    if (segment.interim || !CHANGE.test(segment.text)) continue;
    const said = new Set(queryWords(segment.text));
    const best = open
      .map((decision) => ({ decision, n: queryWords(decision.text).filter((w) => said.has(w)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)[0];
    if (best) out.push({ decision: best.decision, segment });
  }
  return out;
}

export const CLASH_SYSTEM = [
  'You check whether a line said in a meeting changes an earlier decision.',
  'Reply with ONLY a JSON object: {"changes": boolean, "decision": string | null}.',
  '"decision" is the new decision as a short statement in the style of the earlier one (for example "Northwind rollout starts 16 Nov"), or null when it does not change it.',
].join('\n');

export function parseClash(raw: string): { changes: boolean; decision?: string } {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  try {
    const o = JSON.parse(raw.slice(a, b + 1)) as { changes?: unknown; decision?: unknown };
    const decision = typeof o.decision === 'string' && o.decision.trim() ? o.decision.trim() : undefined;
    return { changes: o.changes === true, ...(decision ? { decision } : {}) };
  } catch {
    return { changes: false };
  }
}

export interface Clash extends ClashCandidate { speaker: string; newText: string }

/** Asks the AI about one candidate; undefined when it is not a change. Throws on AI errors. */
export async function confirmClash(meetingId: string, c: ClashCandidate, speaker: string, decisionDate: string, deps: LiveAiDeps = {}): Promise<Clash | undefined> {
  const user = `Earlier decision (${decisionDate}): ${c.decision.text}\nLine just said, by ${speaker}: “${c.segment.text.trim()}”`;
  const reply = parseClash(await liveChat(meetingId, CLASH_LEDGER_WHAT, CLASH_SYSTEM, user, deps, 120));
  if (!reply.changes) return undefined;
  return { ...c, speaker, newText: reply.decision ?? c.segment.text.trim() };
}

/** The new decision "Yes, it replaces it" saves, quoting the line; the store then marks the old one replaced. */
export function replacingDecision(clash: Clash, meetingId: string, now: number, newId: () => string = () => crypto.randomUUID()): MemoryItem {
  return {
    id: newId(), kind: 'decision', status: 'open', text: clash.newText,
    quote: { speaker: clash.speaker, text: clash.segment.text.trim(), meetingId, atMs: clash.segment.startMs },
    meetingId, personIds: clash.decision.personIds, history: [], createdAt: now, updatedAt: now,
  };
}
