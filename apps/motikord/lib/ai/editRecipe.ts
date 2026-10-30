import type { Issue, PatchOp, Recipe } from '../types';
import { chat, type ChatMessage } from '../llm';
import { MAX_CLIP_MS, validateRecipe } from '../recipe/validate';
import { check } from '../checker';
import { applyPatch, PatchError } from '../patch';
import { AiError, toAiError } from './errors';
import { editSystem, retryMessage } from './prompts';
import { applyCheckerFixes, normaliseColour, normaliseLayer, normaliseScene, parseJsonReply, type AiOptions } from './writeRecipe';

export interface EditResult {
  recipe: Recipe; by: 'groq' | 'builtin';
  ops: PatchOp[];        // the model's ops, then any checker fixes; what the Changes tab stores
  inverse: PatchOp[];    // undoes `ops` on the recipe that was passed in
  issues: Issue[];       // what the checker could not fix
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ROOTS = ['/name', '/scenes', '/music', '/creditsEndCard'];
const allowedPath = (p: unknown): p is string => typeof p === 'string' && ROOTS.some((r) => p === r || p.startsWith(`${r}/`));

/** The recipe as the model sees it: files reduced to id, kind and name; no paths, credits or prompt. */
export function compactRecipe(recipe: Recipe): string {
  const assets = Object.fromEntries(Object.values(recipe.assets).map((a) => [a.id, { kind: a.kind, name: a.name }]));
  const { name, type, aspect, scenes, music, creditsEndCard } = recipe;
  return JSON.stringify({ name, type, aspect, scenes, music, creditsEndCard, assets });
}

/** Checks one op's shape and tidies its value; returns a problem in plain words or the op. */
function normaliseOp(raw: unknown, i: number): PatchOp | string {
  const at = `Change ${i + 1}`;
  if (!isObj(raw)) return `${at} is not an object.`;
  const { op, path, from } = raw;
  if (op !== 'replace' && op !== 'add' && op !== 'remove' && op !== 'move') return `${at} op must be replace, add, remove or move.`;
  if (!allowedPath(path)) return `${at} path must start with ${ROOTS.join(', ')}.`;
  if (op === 'remove') return { op, path };
  if (op === 'move') return allowedPath(from) && String(from).startsWith('/scenes') ? { op, from, path } : `${at} can only move scenes or layers.`;
  if (!('value' in raw)) return `${at} has no value.`;
  let value = raw.value;
  const last = path.split('/').pop() ?? '';
  if (['colour', 'fill', 'background'].includes(last)) value = normaliseColour(value);
  else if (/^\/scenes\/(\d+|-)$/.test(path)) value = normaliseScene(value, 0);
  else if (/^\/scenes\/\d+\/layers\/(\d+|-)$/.test(path)) value = normaliseLayer(value, undefined, `l${Date.now().toString(36)}${i}`);
  return { op, path, value };
}

const totalMs = (r: Recipe) => r.scenes.reduce((t, s) => t + (typeof s.durationMs === 'number' ? s.durationMs : 0), 0);

/** Turns a change request into PatchOp[] on `recipe`. Never free code; one retry, then an AiError. */
export async function editRecipe(recipe: Recipe, request: string, opts: AiOptions = {}): Promise<EditResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: editSystem() },
    { role: 'user', content: `Recipe:\n${compactRecipe(recipe)}\n\nChange: ${request}` },
  ];
  const before = new Set(check(recipe).map((i) => i.id));
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply;
    try {
      reply = await chat(messages, { ...opts, json: true, maxTokens: 2000 });
    } catch (e) {
      throw toAiError(e, 'edit');
    }
    const parsed = parseJsonReply(reply.text);
    const rawOps = Array.isArray(parsed) ? parsed : isObj(parsed) ? parsed.ops : undefined;
    problems = [];
    if (!Array.isArray(rawOps) || rawOps.length === 0) problems.push('The reply needs {"ops":[...]} with at least one op.');
    const ops: PatchOp[] = [];
    for (const [i, raw] of (Array.isArray(rawOps) ? rawOps : []).entries()) {
      const op = normaliseOp(raw, i);
      if (typeof op === 'string') problems.push(op);
      else ops.push(op);
    }
    if (problems.length === 0) {
      try {
        const next = applyPatch(recipe, ops).doc;
        // Nothing changes when an edit would run past 60 s ("change-too-long"); a retry would not be what was asked.
        const total = totalMs(next);
        if (total > MAX_CLIP_MS) throw new AiError('change-too-long', 'edit', { totalMs: total });
        problems = validateRecipe(next);
        if (problems.length === 0) {
          const fixed = applyCheckerFixes(next, before);
          const all = [...ops, ...fixed.ops];
          const { doc, inverse } = applyPatch(recipe, all);
          return { recipe: doc, by: reply.by, ops: all, inverse, issues: fixed.issues };
        }
      } catch (e) {
        if (e instanceof AiError) throw e;
        problems = [e instanceof PatchError ? e.message : 'The changes could not be applied.'];
      }
    }
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: retryMessage(problems) });
  }
  throw new AiError('invalid-reply', 'edit', { problems });
}
