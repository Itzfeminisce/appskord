import type { Issue, Layer, Motion, PatchOp, PresetSlot, Recipe, Scene } from '../types';
import { chat, type ChatMessage, type ChatOptions } from '../llm';
import { MAX_CLIP_MS, validateRecipe } from '../recipe/validate';
import { check } from '../checker';
import { applyPatch } from '../patch';
import { getPreset } from '../render/presets';
import { AiError, toAiError, type AiStateId } from './errors';
import { recipeSystem, retryMessage, type RecipePromptInput } from './prompts';

export type AiOptions = Omit<ChatOptions, 'json' | 'maxTokens'>;

export interface WriteInput extends RecipePromptInput {
  prompt: string;
  id?: string;               // new clip id; random when absent
}
export interface WriteResult {
  recipe: Recipe; by: 'groq' | 'builtin';
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
  const total = totalMs(recipe.scenes);
  if (total <= MAX_CLIP_MS) return recipe;
  const k = MAX_CLIP_MS / total;
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

/** Turns a prompt into a valid, checked Recipe. One call, one retry with the problems, then an AiError. */
export async function writeRecipe(input: WriteInput, opts: AiOptions = {}): Promise<WriteResult> {
  const id = input.id ?? newId();
  const messages: ChatMessage[] = [
    { role: 'system', content: recipeSystem(input) },
    { role: 'user', content: input.prompt },
  ];
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply;
    try {
      reply = await chat(messages, { ...opts, json: true, maxTokens: 4000 });
    } catch (e) {
      throw toAiError(e, 'make');
    }
    const parsed = parseJsonReply(reply.text);
    let candidate = draftToRecipe(parsed, input, id);
    const notices: AiStateId[] = [];
    if (isObj(candidate) && Array.isArray(candidate.scenes) && candidate.scenes.every((sc) => isObj(sc) && Array.isArray(sc.layers) && sc.layers.every(isObj))) {
      const r = candidate as unknown as Recipe;
      if (totalMs(r.scenes) > MAX_CLIP_MS) { candidate = fitToMax(r); notices.push('too-long'); }
    }
    problems = parsed === undefined ? ['The reply was not JSON.'] : validateRecipe(candidate);
    if (problems.length === 0) {
      const recipe = candidate as Recipe;
      const checkerClean = check(recipe).length === 0;
      const fixed = applyCheckerFixes(recipe);
      return { recipe: fixed.recipe, by: reply.by, notices, checkerClean, issues: fixed.issues };
    }
    messages.push({ role: 'assistant', content: reply.text }, { role: 'user', content: retryMessage(problems) });
  }
  throw new AiError('invalid-reply', 'make', { problems });
}

