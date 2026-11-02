// Which of the four "Cover these" prompts the telling has touched, matched locally on words. Pure, no AI.
import type { Segment } from '../types';
import type { CatchupPrompt, PromptCoverage } from './types';

export const CATCHUP_PROMPTS: readonly CatchupPrompt[] = ['who', 'decided', 'promised', 'open'];

export const PROMPT_TEXT: Record<CatchupPrompt, string> = {
  who: 'Who was there',
  decided: 'What was decided',
  promised: 'Who promised what, and by when',
  open: 'What is still open',
};

const DAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|today|next week|end of (?:the )?(?:day|week|month))';

// The agenda matcher (lib/live/agenda.ts) needs words from the item's own text; these prompts are answered in other words, so each has cue phrases.
const CUES: Record<CatchupPrompt, RegExp> = {
  who: /\b(?:(?:was|were) (?:there|at it|on the call|in the room)|joined|attended|showed up|came along|(?:dropped|was|were) (?:off|missing|absent)|it was (?:just )?(?:me|us) and)\b/,
  decided: /\b(?:decided?|decision|agreed?|agreement|settled|chose|choose|going with|go with|approved?|signed off on|landed on|final call)\b/,
  promised: new RegExp(`\\b(?:i'll|i will|i'd|we'll|he'll|she'll|they'll|will (?:send|do|get|share|set|write|book|look|follow)|(?:is|are|am) (?:setting up|sending|doing|handling|taking|writing|on it)|promised?|owes?|take (?:it|that|this) on|took (?:it|that|this|on)|follow up|by ${DAY})\\b`),
  open: /(?:\?\s*$|\b(?:still open|open question|not sure|unsure|unclear|(?:don't|didn't|do not|did not) know|(?:no one|nobody) (?:knows|knew)|no idea|to be decided|tbd|figure out|undecided|still need to|left open|pending)\b)/,
};

const normal = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").trim();

/** True when a line of the telling speaks to the prompt. */
export function speaksTo(prompt: CatchupPrompt, line: string): boolean {
  return CUES[prompt].test(normal(line));
}

/** Each prompt in order, covered at the first final line that speaks to it. */
export function cover(segments: readonly Segment[], prompts: readonly CatchupPrompt[] = CATCHUP_PROMPTS): PromptCoverage[] {
  const lines = segments.filter((s) => !s.interim && s.text.trim()).sort((a, b) => a.startMs - b.startMs);
  return prompts.map((prompt) => {
    const hit = lines.find((s) => speaksTo(prompt, s.text));
    return hit ? { prompt, coveredAtMs: hit.startMs } : { prompt };
  });
}

/** The prompt the newest final line speaks to, if any: the frame's "Now" row. */
export function talkingAbout(segments: readonly Segment[], prompts: readonly CatchupPrompt[] = CATCHUP_PROMPTS): CatchupPrompt | undefined {
  const last = segments.filter((s) => !s.interim && s.text.trim()).sort((a, b) => a.startMs - b.startMs).at(-1);
  return last ? prompts.find((p) => speaksTo(p, last.text)) : undefined;
}
