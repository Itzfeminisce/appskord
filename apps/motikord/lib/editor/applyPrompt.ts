import { editRecipe, type EditResult } from '../ai/editRecipe';
import { AiError, toAiError } from '../ai/errors';
import type { AiOptions } from '../ai/writeRecipe';
import { applyPatch } from '../patch';
import { validateRecipe } from '../recipe/validate';
import type { Recipe } from '../types';
import { describe, promptSummary } from './changes';
import type { Edit } from './store';

// A prompt edit: ask the AI, check the result, and hand back one Change. A failure throws and the recipe stays as it was.

/** Longer than this and the request is given up as Groq not responding. */
export const PROMPT_TIMEOUT_MS = 45_000;

export interface PromptEdit { edit: Edit; by: 'groq' | 'builtin'; detail: string; recipe: Recipe }
export interface PromptOptions extends AiOptions {
  timeoutMs?: number;
  /** editRecipe, replaced in tests. */
  run?: (recipe: Recipe, request: string, opts: AiOptions) => Promise<EditResult>;
}

export async function applyPrompt(recipe: Recipe, prompt: string, opts: PromptOptions = {}): Promise<PromptEdit> {
  const { timeoutMs = PROMPT_TIMEOUT_MS, run = editRecipe, signal, ...ai } = opts;
  if (signal?.aborted) throw new AiError('cancelled', 'edit');
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  const stop = () => ac.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const out = await run(recipe, prompt, { ...ai, signal: ac.signal });
    if (ac.signal.aborted) throw new DOMException('Stopped', 'AbortError');
    // Re-check on our side: only a recipe the validator accepts is ever applied.
    const next = applyPatch(recipe, out.ops).doc;
    if (validateRecipe(next).length > 0) throw new AiError('invalid-reply', 'edit');
    const detail = describe(recipe, next);
    return { edit: { ops: out.ops, summary: promptSummary(prompt, detail) }, by: out.by, detail, recipe: next };
  } catch (error) {
    if (timedOut) throw new AiError('server', 'edit');
    if (signal?.aborted) throw new AiError('cancelled', 'edit');
    throw toAiError(error, 'edit');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
  }
}

/** The clip changed while the AI was answering: the same ops, re-checked against the clip as it is now, or undefined. */
export function rebase(out: PromptEdit, prompt: string, from: Recipe, now: Recipe): PromptEdit | undefined {
  if (now === from) return out;
  let next: Recipe;
  try { next = applyPatch(now, out.edit.ops).doc; } catch { return undefined; }
  if (validateRecipe(next).length > 0) return undefined;
  const detail = describe(now, next);
  return { ...out, edit: { ...out.edit, summary: promptSummary(prompt, detail) }, detail, recipe: next };
}
