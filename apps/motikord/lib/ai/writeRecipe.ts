import type { Issue, Layer, Motion, PatchOp, PresetSlot, Recipe, Scene } from '../types';
import { chat, LLMError, type ChatMessage, type ChatOptions } from '../llm';
import { MAX_CLIP_MS, validateRecipe } from '../recipe/validate';
import { check } from '../checker';
import { applyPatch } from '../patch';
import { getPreset } from '../render/presets';
import { AiError, toAiError, type AiStateId } from './errors';
import { critiqueMessage, planSystem, recipeRequest, recipeSystem, retryMessage, SCENE_RANGE, SHORTER, type ClipPlan, type PlanScene, type RecipePromptInput } from './prompts';

export type AiOptions = Omit<ChatOptions, 'json' | 'maxTokens'>;

export const RECIPE_TOKENS = 4000;
export const PLAN_TOKENS = 900;
// Groq's free tier: each call's prompt plus max_tokens stays under this.
export const CALL_BUDGET = 8000;
export const estimateTokens = (messages: ChatMessage[]) => Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 3);

export interface WriteInput extends RecipePromptInput {
  prompt: string;
  id?: string;               // new clip id; random when absent
}
export interface WriteResult {
  recipe: Recipe; by: import('../types').Provider | 'builtin';
  notices: AiStateId[];      // 'too-long' when the idea ran past 60 s and was cut to fit
  checkerClean: boolean;     // the reply passed the checker before any fixes
  issues: Issue[];           // what the checker could not fix
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Pulls the first JSON value out of a reply, allowing code fences and chatter around it. */
export function parseJsonReply(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const body = (fenced ?? text).trim();
  try { return JSON.parse(body); } catch { /* try the outermost braces */ }
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return undefined; }
}

const NAMED: Record<string, string> = {
  white: '#FFFFFF', black: '#000000', red: '#DC2626', green: '#16A34A', blue: '#2563EB', yellow: '#FACC15',
  orange: '#F97316', purple: '#7C3AED', pink: '#DB2777', grey: '#6B7280', gray: '#6B7280', none: 'transparent', transparent: 'transparent',
};
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();

/** Turns the colour forms models like to send into "#RRGGBB" or "transparent"; leaves anything else for the validator. */
export function normaliseColour(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  const named = NAMED[s.toLowerCase()];
  if (named) return named;
  const h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)?.[1];
  if (h) return `#${(h.length === 3 ? [...h].map((c) => c + c).join('') : h).toUpperCase()}`;
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (rgb) return rgb[4] !== undefined && Number(rgb[4]) === 0 ? 'transparent' : `#${hex2(+rgb[1]!)}${hex2(+rgb[2]!)}${hex2(+rgb[3]!)}`;
  return s;
}

function normaliseMotion(m: unknown, slot: PresetSlot): unknown {
  if (!isObj(m)) return m;
  let preset = typeof m.preset === 'string' ? m.preset.trim().toLowerCase() : m.preset;
  // "fade" for "Comes in" means fade-in; only rename to an id that exists in that slot.
  if (typeof preset === 'string' && getPreset(preset)?.slot !== slot && getPreset(`${preset}-${slot}`)?.slot === slot) preset = `${preset}-${slot}`;
  const known = typeof preset === 'string' ? getPreset(preset) : undefined;
  return { preset, feel: typeof m.feel === 'string' ? m.feel.toLowerCase() : 'smooth', durationMs: num(m.durationMs, known?.defaultMs ?? 600) };
}

/** Fills the defaults a model often leaves out, and fixes number and colour forms. Never invents media. */
export function normaliseLayer(raw: unknown, sceneMs: number | undefined, fallbackId: string): unknown {
  if (!isObj(raw)) return raw;
  const l: Obj = { ...raw };
  l.id = typeof l.id === 'string' && l.id.trim() ? l.id : fallbackId;
  if (typeof l.name !== 'string') l.name = typeof l.role === 'string' && l.role ? l.role[0]!.toUpperCase() + l.role.slice(1) : String(l.type ?? 'Layer');
  l.startMs = Math.max(0, num(l.startMs, 0));
  l.endMs = num(l.endMs, sceneMs ?? (l.startMs as number) + 3000);
  if (sceneMs !== undefined && (l.endMs as number) > sceneMs) l.endMs = sceneMs;
  l.opacity = Math.max(0, Math.min(1, num(l.opacity, 1)));
  if (isObj(l.box)) l.box = Object.fromEntries(Object.entries(l.box).map(([k, v]) => [k, num(v, v as number)]));
  for (const slot of ['in', 'during', 'out'] as const) {
    if (l[slot] === null) delete l[slot];
    else if (l[slot] !== undefined) l[slot] = normaliseMotion(l[slot], slot);
  }
  for (const k of ['colour', 'fill', 'background'] as const) if (l[k] !== undefined) l[k] = normaliseColour(l[k]);
  if (l.background === null || l.background === 'transparent') delete l.background;
  if (l.type === 'text') {
    l.role ??= 'body';
    l.font ??= 'Geist';
    l.sizePx = num(l.sizePx, l.role === 'title' ? 96 : 56);
    l.weight = num(l.weight, l.role === 'title' ? 700 : 500);
    l.align ??= 'center';
    l.lineHeight = num(l.lineHeight, 1.15);
    l.colour ??= '#FFFFFF';
  }
  if (l.type === 'image' || l.type === 'video') l.fit ??= 'cover';
  return l;
}

export function normaliseScene(raw: unknown, index: number): unknown {
  if (!isObj(raw)) return raw;
  const s: Obj = { ...raw };
  s.id = typeof s.id === 'string' && s.id.trim() ? s.id : `s${index + 1}`;
  s.durationMs = num(s.durationMs, 3000);
  s.background = normaliseColour(s.background ?? '#111114');
  if (typeof s.layout === 'string') s.layout = s.layout.trim().toLowerCase();
  else s.layout = 'center';
  if (Array.isArray(s.layers)) s.layers = s.layers.map((l, j) => normaliseLayer(l, s.durationMs as number, `${s.id}-l${j + 1}`));
  return s;
}

const totalMs = (scenes: Scene[]) => scenes.reduce((t, s) => t + (s.durationMs || 0), 0);

/** Shrinks every time in proportion so the clip ends at 60 s. */
export function fitToMax(recipe: Recipe): Recipe {
  return totalMs(recipe.scenes) <= MAX_CLIP_MS ? recipe : scaleTo(recipe, MAX_CLIP_MS);
}

/** Stretches or shrinks every time in proportion so the clip lasts `targetMs`. */
export function scaleTo(recipe: Recipe, targetMs: number): Recipe {
  const total = totalMs(recipe.scenes);
  if (total <= 0) return recipe;
  const k = targetMs / total;
  const t = (ms: number) => Math.floor(ms * k);
  const motion = (m?: Motion) => (m ? { ...m, durationMs: Math.max(1, t(m.durationMs)) } : m);
  const scenes = recipe.scenes.map((s) => {
    const dur = Math.max(1, t(s.durationMs));
    return {
      ...s, durationMs: dur,
      layers: s.layers.map((l) => {
        const startMs = Math.min(t(l.startMs), dur - 1);
        const out = { ...l, startMs, endMs: Math.max(startMs + 1, Math.min(t(l.endMs), dur)) } as Layer;
        for (const slot of ['in', 'during', 'out'] as const) if (l[slot]) out[slot] = motion(l[slot]);
        return out;
      }),
    };
  });
  return { ...recipe, scenes };
}

/** Applies each checker fix that applies cleanly, a few passes deep; returns the fixed recipe and the ops used. */
export function applyCheckerFixes(recipe: Recipe, skip: Set<string> = new Set()): { recipe: Recipe; ops: PatchOp[]; issues: Issue[] } {
  let current = recipe;
  const ops: PatchOp[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const issues = check(current).filter((i) => !skip.has(i.id) && i.fix.length > 0);
    if (issues.length === 0) break;
    let changed = false;
    for (const issue of issues) {
      try {
        const next = applyPatch(current, issue.fix).doc;
        if (validateRecipe(next).length === 0) { current = next; ops.push(...issue.fix); changed = true; }
      } catch { /* a fix made stale by an earlier fix; the next pass re-checks */ }
    }
    if (!changed) break;
  }
  return { recipe: current, ops, issues: check(current).filter((i) => !skip.has(i.id)) };
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now().toString(36)}`);

/** Builds a full Recipe from the model's draft: our id, type, size and assets; the model's name and scenes. */
export function draftToRecipe(draft: unknown, input: WriteInput, id: string): unknown {
  if (!isObj(draft)) return draft;
  const assets = Object.fromEntries(input.assets.map((a) => [a.id, a]));
  const recipe: Obj = {
    version: 1, id, name: typeof draft.name === 'string' ? draft.name : input.prompt.slice(0, 40),
    type: input.type, aspect: input.aspect, assets, prompt: input.prompt,
    scenes: Array.isArray(draft.scenes) ? draft.scenes.map(normaliseScene) : draft.scenes,
  };
  if (draft.music !== undefined) recipe.music = draft.music;
  return recipe;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Keeps the plan fields step 2 needs; undefined when the reply holds no usable scenes. */
export function readPlan(raw: unknown): ClipPlan | undefined {
  if (!isObj(raw) || !Array.isArray(raw.scenes)) return undefined;
  const scenes: PlanScene[] = raw.scenes.filter(isObj).slice(0, 8).flatMap((sc) => {
    const headline = clean(sc.headline, 80);
    if (!headline) return [];
    const out: PlanScene = { headline };
    if (typeof sc.ms === 'number' && sc.ms > 0) out.ms = Math.round(sc.ms);
    for (const k of ['support', 'visual', 'layout', 'bg', 'accent', 'motion'] as const) { const v = clean(sc[k], 120); if (v) out[k] = v; }
    return [out];
  });
  if (scenes.length === 0) return undefined;
  const plan: ClipPlan = { scenes };
  const name = clean(raw.name, 40); if (name) plan.name = name;
  const hook = clean(raw.hook, 120); if (hook) plan.hook = hook;
  return plan;
}

/** Step 1. A plan the model could not write is skipped; a failed call is the same failure the recipe call would hit. */
export async function planClip(input: WriteInput, opts: AiOptions = {}): Promise<ClipPlan | undefined> {
  try {
    const reply = await chat([{ role: 'system', content: planSystem(input) }, { role: 'user', content: input.prompt }], { ...opts, json: true, maxTokens: PLAN_TOKENS, temperature: 0.7 });
    return readPlan(parseJsonReply(reply.text));
  } catch (e) {
    if (e instanceof LLMError && e.code === 'bad-reply') return undefined;
    throw toAiError(e, 'make');
  }
}

const words = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** What a motion designer would send back: too few scenes for the type, or a title pasted from the prompt. */
export function designNotes(recipe: Recipe, prompt: string): string[] {
  const notes: string[] = [];
  const [lo, hi] = SCENE_RANGE[recipe.type];
  if (lo >= 4 && recipe.scenes.length <= 2) notes.push(`Use ${lo} to ${hi} scenes, one idea each: a hook, the beats that build, and a closing call to action.`);
  if (recipe.type !== 'quote' && recipe.type !== 'captions') {
    const p = ` ${words(prompt).join(' ')} `;
    for (const sc of recipe.scenes) for (const l of sc.layers) {
      if (l.type !== 'text' || l.role !== 'title') continue;
      const w = words(l.text);
      if (w.length >= 5 && p.includes(` ${w.join(' ')} `)) notes.push(`The title "${l.text}" copies the prompt. Write a fresh 3 to 7 word headline.`);
    }
  }
  return notes;
}

/** Gives every text layer that has none an "in" and an "out", so nothing just appears or vanishes. */
export function addMissingMotion(recipe: Recipe): Recipe {
  const scenes = recipe.scenes.map((s) => ({
    ...s,
    layers: s.layers.map((l) => {
      if (l.type !== 'text' || l.endMs - l.startMs < 1500 || (l.in && l.out)) return l;
      const inId = l.role === 'title' ? 'rise-in' : 'fade-in';
      return { ...l, in: l.in ?? { preset: inId, feel: 'smooth' as const, durationMs: getPreset(inId)!.defaultMs }, out: l.out ?? { preset: 'fade-out', feel: 'smooth' as const, durationMs: getPreset('fade-out')!.defaultMs } };
    }),
  }));
  return { ...recipe, scenes };
}

type Attempt = { ok: true; recipe: Recipe; by: WriteResult['by']; notices: AiStateId[]; text: string } | { ok: false; problems: string[] };

/** One call and its checks. Returns the problems instead of throwing when the reply is unusable. */
async function draftOnce(messages: ChatMessage[], input: WriteInput, id: string, opts: AiOptions, firstTry: boolean): Promise<Attempt & { parsed?: unknown; text?: string }> {
  let reply;
  try {
    reply = await chat(messages, { ...opts, json: true, maxTokens: RECIPE_TOKENS });
  } catch (e) {
    if (e instanceof LLMError && e.code === 'bad-reply' && firstTry) return { ok: false, problems: ['The reply was not JSON.'] };
    throw toAiError(e, 'make');
  }
  const parsed = parseJsonReply(reply.text);
  let candidate = draftToRecipe(parsed, input, id);
  const notices: AiStateId[] = [];
  if (isObj(candidate) && Array.isArray(candidate.scenes) && candidate.scenes.every((sc) => isObj(sc) && Array.isArray(sc.layers) && sc.layers.every(isObj))) {
    const r = candidate as unknown as Recipe;
    if (totalMs(r.scenes) > MAX_CLIP_MS) { candidate = fitToMax(r); notices.push('too-long'); }
  }
  const problems = parsed === undefined ? ['The reply was not JSON.'] : validateRecipe(candidate);
  if (problems.length) return { ok: false, problems, parsed, text: reply.text };
  return { ok: true, recipe: candidate as Recipe, by: reply.by, notices, text: reply.text };
}

/** Adds the model's last reply to a retry only when the call still fits the free-tier budget. */
const withReply = (base: ChatMessage[], text: string | undefined, follow: string): ChatMessage[] => {
  const full: ChatMessage[] = text ? [...base, { role: 'assistant', content: text }, { role: 'user', content: follow }] : [];
  return full.length && estimateTokens(full) + RECIPE_TOKENS <= CALL_BUDGET ? full : [...base, { role: 'user', content: follow }];
};

function finish(a: Extract<Attempt, { ok: true }>, input: WriteInput): WriteResult {
  let recipe = addMissingMotion(a.recipe);
  const total = totalMs(recipe.scenes);
  // Asked for a length and the reply is well off it: stretch or shrink in proportion.
  if (input.lengthMs && Math.abs(total - input.lengthMs) > input.lengthMs * 0.2) {
    const scaled = scaleTo(recipe, Math.min(MAX_CLIP_MS, input.lengthMs));
    if (validateRecipe(scaled).length === 0) recipe = scaled;
  }
  const checkerClean = check(recipe).length === 0;
  const fixed = applyCheckerFixes(recipe);
  return { recipe: fixed.recipe, by: a.by, notices: a.notices, checkerClean, issues: fixed.issues };
}

/** Turns a prompt into a valid, checked Recipe: a creative plan, the recipe, one retry for problems and one for a flat design. */
export async function writeRecipe(input: WriteInput, opts: AiOptions = {}): Promise<WriteResult> {
  const id = input.id ?? newId();
  const plan = await planClip(input, opts);
  const base: ChatMessage[] = [
    { role: 'system', content: recipeSystem(input) },
    { role: 'user', content: recipeRequest(input.prompt, plan) },
  ];
  let messages = base;
  let first: Extract<Attempt, { ok: true }> | undefined;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2 && !first; attempt++) {
    const a = await draftOnce(messages, input, id, opts, attempt === 0);
    if (a.ok) { first = a; break; }
    problems = a.problems;
    // A reply that was not JSON is no use to fix; ask again instead of sending it back.
    messages = a.parsed === undefined ? [...base, { role: 'user', content: SHORTER }] : withReply(base, a.text, retryMessage(problems));
  }
  if (!first) throw new AiError('invalid-reply', 'make', { problems });

  const notes = designNotes(first.recipe, input.prompt);
  if (notes.length === 0) return finish(first, input);
  try {
    const again = await draftOnce(withReply(base, first.text, critiqueMessage(notes)), input, id, opts, false);
    if (again.ok && designNotes(again.recipe, input.prompt).length < notes.length) return finish(again, input);
  } catch (e) {
    if (e instanceof AiError && e.code === 'cancelled') throw e;
    // The first recipe is valid; a failed second try still makes the clip.
  }
  return finish(first, input);
}
