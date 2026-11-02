import type { ChatMessage } from '../llm';
import { commit } from '../project/history';
import { LABELS, setCaptions } from '../project/ops';
import type { Project } from '../project/types';
import { AiError, parseReply, type Call } from './ops';
import { MAX_CALL_TOKENS, tokens } from './prompt';

const system = (language: string) =>
  `Translate each caption line into ${language}. Keep the meaning, names and product words; keep each line short. ` +
  'Reply with one JSON object: {"lines":["..."]} with exactly one translated line per input line, in the same order.';

/** Lines per call: the lines go out once and come back translated, so each side gets under half the budget. */
export function lineChunks(lines: string[], budget = (MAX_CALL_TOKENS - 600) / 2): string[][] {
  const out: string[][] = [];
  let part: string[] = [];
  let size = 0;
  for (const line of lines) {
    const cost = tokens(JSON.stringify(line)) + 1;
    if (part.length && size + cost > budget) { out.push(part); part = []; size = 0; }
    part.push(line);
    size += cost;
  }
  if (part.length) out.push(part);
  return out;
}

/** The translated lines of a reply, or the problem with it. */
export function checkLines(raw: unknown, count: number): { lines?: string[]; problem?: string } {
  const lines = (raw as { lines?: unknown } | undefined)?.lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l === 'string')) return { problem: 'The reply must be {"lines":[...]} with strings.' };
  if (lines.length !== count) return { problem: `Send exactly ${count} lines; that reply had ${lines.length}.` };
  return { lines: lines.map((l: string) => l.trim()) };
}

/** Translates caption lines in calls under 8,000 tokens; a bad reply is repaired once, then `failed`. */
export async function translateLines(lines: string[], language: string, call: Call): Promise<string[]> {
  const out: string[] = [];
  for (const part of lineChunks(lines)) {
    const messages: ChatMessage[] = [{ role: 'system', content: system(language) }, { role: 'user', content: JSON.stringify({ lines: part }) }];
    const maxTokens = Math.min(3_600, tokens(JSON.stringify(part)) * 2 + 200);
    const reply = await call(messages, { maxTokens });
    let checked = checkLines(parseReply(reply), part.length);
    if (checked.problem) {
      const again = await call([...messages, { role: 'assistant', content: reply }, { role: 'user', content: `${checked.problem} Reply again with the JSON only.` }], { maxTokens });
      checked = checkLines(parseReply(again), part.length);
    }
    if (!checked.lines) throw new AiError('failed');
    out.push(...checked.lines);
  }
  return out;
}

/** "Done": the language's lines, and whether it shows in the video, as one Undo step. */
export function saveTranslation(project: Project, { language, lines, show }: { language: string; lines: string[]; show: boolean }): Project {
  const withLines = { ...project, translations: { ...project.translations, [language]: lines } };
  const shown = setCaptions(withLines, { patch: { language: show ? language : undefined, ...(show && { show: true }) } });
  return commit(project, LABELS.translated(language), { ...shown, history: project.history });
}
