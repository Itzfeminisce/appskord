import type {
  Aspect, Asset, BrandKit, ClipType, Issue, Layer, Mood, Motion, Pace, PatchOp, PresetSlot, Provider, Recipe, Scene,
  Settings, SlotValue, StyleId, Storyboard, StylePack,
} from '../types';
import { chat, LLMError, type ChatMessage, type ChatOptions } from '../llm';
import { MAX_CLIP_MS, validateRecipe } from '../recipe/validate';
import { autoFix, check } from '../checker';
import { applyPatch } from '../patch';
import { getPreset } from '../render/presets';
import { AiError, toAiError, type AiStateId } from './errors';
import { toV2 } from '../recipe/migrate';
import { renderFrames } from '../render/frames';
import { cutWords, expandScene } from '../templates/expand';
import { paceMs, transitionFor } from '../templates/pick';
import { autoStyle, getPack, getSceneTemplate } from '../templates/scenes';
import { criticModel, criticScenes, criticSkip, runCritic, type CriticRun, type CriticSkip, type FrameRenderer } from './critic';
import { assignMedia, fillScene, mergeSlots, storyboardOf } from './fillScene';
import { cleanStoryboard, planStoryboard, StoryboardFailed } from './storyboard';
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

// ---- v2 pipeline: storyboard, one fill per scene, layout check and fixes, then the visual critic ----

/** Making's steps (MakingStoryboard): planning, filling, checking, looking at frames, opening the editor. */
export type MakeStep = 'plan' | 'fill' | 'check' | 'critic' | 'open';
/** The pause point: resolves with the storyboard to make (edited or not), or 'replan' for "Plan it again". */
export type Gate = (storyboard: Storyboard) => Promise<Storyboard | 'replan'>;

export interface PipelineEvents {
  onStep?(step: MakeStep): void;
  onStoryboard?(storyboard: Storyboard): void;
  gate?: Gate;
  look?(): Promise<{ style: StyleId; pace: Pace; mood: Mood } | undefined>;   // read again after the pause point, so a look changed while paused applies
  onFilling?(index: number, total: number): void;   // the scene being filled now ("Scene 3 · List")
  onFilled?(done: number, total: number): void;
  onRetry?(index: number): void;                    // scene-retrying
  onFixes?(notes: string[]): void;                  // "Fixed 2 things"
  onCritic?(look: { scenes: number[]; frames: number }): void;
  onCriticSkipped?(skip: CriticSkip, model: string): void;
  frames?: FrameRenderer;
}

export interface ClipInput {
  prompt: string; type: ClipType; aspect: Aspect; assets: Asset[]; id?: string; lengthMs?: number;
  style: StyleId; pace: Pace; mood?: Mood;
  brand?: BrandKit;                                  // only when it is used for new clips
  critic: boolean; settings: Pick<Settings, 'ai' | 'provider' | 'models'>;
}
export interface ClipResult {
  recipe: Recipe; by: Provider | 'builtin'; storyboard: Storyboard;
  fixes: string[];                                   // the "Fixed for you" lines, in order
  issues: Issue[];                                   // what is left for the quality check
  critic?: CriticRun; criticSkipped?: CriticSkip;
  notices: AiStateId[];
}

// Checker kinds that fewer or other words can clear; the rest are layout or colour, not words.
const WORD_FIXES: Partial<Record<Issue['kind'], string>> = {
  overflow: 'Some text runs out of its box: use fewer words.',
  crowding: 'The scene is crowded: fewer, shorter items.',
  overlap: 'Text overlaps other text: shorten it.',
  words: 'Some text is over its word limit.',
  empty: 'A slot is empty: fill it.',
  'too-small': 'Text is too small to read: use fewer words.',
  'too-fast': 'Too many words to read in the time: use fewer.',
};

/** A scene with new slots, expanded in the pack's look; its "Show original" text goes. */
function withSlots(recipe: Recipe, index: number, slots: Record<string, SlotValue>, pack: StylePack, brand?: BrandKit): Recipe {
  const s = recipe.scenes[index]!;
  const scenes = recipe.scenes.slice();
  scenes[index] = expandScene({ ...s, slots, original: undefined }, pack, brand);
  return { ...recipe, scenes };
}

const packFor = (style: StyleId | undefined, type: ClipType) => getPack(style ?? autoStyle(type)) ?? getPack('clean')!;

/** The recipe a storyboard and its filled slots make: version 2, every scene templated and expanded. */
export function buildRecipe(sb: Storyboard, slots: Record<string, SlotValue>[], input: Omit<ClipInput, 'critic' | 'settings'>, id: string): Recipe {
  const pack = packFor(input.style, input.type);
  const scenes: Scene[] = sb.beats.map((b, i) => {
    const s: Scene = { id: `s${i + 1}`, durationMs: b.ms, background: pack.palette.bg, layout: 'center', layers: [], template: b.template, slots: slots[i] ?? {} };
    if (i > 0) s.transition = transitionFor(pack, i, input.pace);
    return expandScene(s, pack, input.brand);
  });
  return {
    version: 2, id, name: sb.name, type: input.type, aspect: input.aspect, scenes,
    assets: Object.fromEntries(input.assets.map((a) => [a.id, a])), prompt: input.prompt || undefined,
    style: pack.id, pace: input.pace, ...(input.mood ? { mood: input.mood } : {}),
  };
}

/** A storyboard that runs past 60 s, shortened in proportion. */
function fitStoryboard(sb: Storyboard): { storyboard: Storyboard; cut: boolean } {
  const total = sb.beats.reduce((t, b) => t + b.ms, 0);
  if (total <= MAX_CLIP_MS) return { storyboard: sb, cut: false };
  const k = MAX_CLIP_MS / total;
  return { storyboard: { ...sb, beats: sb.beats.map((b) => ({ ...b, ms: Math.max(1000, Math.floor((b.ms * k) / 50) * 50) })) }, cut: true };
}

// What the checker's own fix does, as a "Fixed for you" line; used after the word fixes for what words could not clear.
// Overflow is not here: text is never made smaller than its slot's type size (cutToFit cuts the words instead).
const SETTLE: Partial<Record<Issue['kind'], (n: number, name: string) => string>> = {
  'too-small': (n, name) => `Scene ${n} ${name} made bigger to read`,
  contrast: (n, name) => `Scene ${n} ${name} recoloured to stand out`,
  'too-fast': (n, name) => `Scene ${n} ${name} stays on screen longer`,
};

const wordCount = (v: string) => v.trim().split(/\s+/).filter(Boolean).length;
const overflows = (r: Recipe, layerId: string, brand?: BrandKit) => check(r, { brand }).some((i) => i.kind === 'overflow' && i.layerId === layerId);

/** Text that runs out of its template box, cut a word at a time until it fits at its type size; `original` keeps it whole. */
function cutToFit(recipe: Recipe, brand?: BrandKit): { recipe: Recipe; notes: string[] } {
  let cur = recipe;
  const notes: string[] = [];
  const tried = new Set<string>();
  const pack = getPack(recipe.style ?? 'clean');
  for (let n = 0; pack && n < 30; n++) {
    const next = check(cur, { brand }).find((i) => i.kind === 'overflow' && !tried.has(i.layerId));
    if (!next) break;
    tried.add(next.layerId);
    const si = cur.scenes.findIndex((s) => s.id === next.sceneId);
    const scene = cur.scenes[si];
    const layer = scene?.layers.find((l) => l.id === next.layerId);
    const slot = layer?.slot;
    const def = scene?.template && slot ? getSceneTemplate(scene.template)?.slots.find((d) => d.id === slot && d.kind === 'text') : undefined;
    const v = slot ? scene?.slots?.[slot] : undefined;
    if (!scene || !layer || !def || typeof v !== 'string') continue;
    const full = scene.original?.[def.id] ?? v;
    for (let k = wordCount(v) - 1; k >= 1; k--) {
      const fresh = expandScene({ ...scene, slots: { ...scene.slots, [def.id]: cutWords(v, k) } }, pack, brand);
      fresh.original = { ...fresh.original, [def.id]: full };
      const scenes = [...cur.scenes];
      scenes[si] = fresh;
      const trial = { ...cur, scenes };
      if (overflows(trial, layer.id, brand)) continue;
      cur = trial;
      notes.push(`Scene ${si + 1} ${def.name.toLowerCase()} cut to ${k} words`);
      break;
    }
  }
  return { recipe: cur, notes };
}

/** Cuts overflowing words, then applies the checker's size, colour and timing fixes one at a time, keeping only those that clear their issue. */
export function settleLayout(recipe: Recipe, brand?: BrandKit): { recipe: Recipe; notes: string[] } {
  const fit = cutToFit(recipe, brand);
  let cur = fit.recipe;
  const notes: string[] = [...fit.notes];
  const tried = new Set<string>();
  for (let n = 0; n < 60; n++) {
    const next = check(cur, { brand }).find((i) => SETTLE[i.kind] && i.fix.length > 0 && !tried.has(i.id));
    if (!next) break;
    tried.add(next.id);
    let after: Recipe;
    try { after = applyPatch(cur, next.fix).doc; } catch { continue; }
    const left = check(after, { brand });
    if (left.some((i) => i.id === next.id) || left.length >= check(cur, { brand }).length) continue;
    cur = after;
    const si = cur.scenes.findIndex((s) => s.id === next.sceneId);
    const layer = cur.scenes[si]?.layers.find((l) => l.id === next.layerId);
    const note = SETTLE[next.kind]!(si + 1, (layer?.name ?? 'text').toLowerCase());
    if (!notes.includes(note)) notes.push(note);
  }
  return { recipe: cur, notes };
}

const rethrowCancel = (e: unknown) => { if (e instanceof AiError && e.code === 'cancelled') throw e; };

/** The whole v2 make. Throws AiError, or StoryboardFailed when the plan made no sense twice. */
export async function writeClip(input: ClipInput, opts: AiOptions = {}, ev: PipelineEvents = {}): Promise<ClipResult> {
  const id = input.id ?? newId();
  let pack = packFor(input.style, input.type);
  let { pace, mood } = input;
  const media = input.assets.filter((a) => a.kind === 'image' || a.kind === 'video').length;
  const logo = !!input.brand?.logoAssetId || input.assets.some((a) => a.kind === 'logo');
  const plan = () => planStoryboard({ prompt: input.prompt, type: input.type, aspect: input.aspect, style: pack.id, pace, lengthMs: input.lengthMs, media, logo }, opts);

  ev.onStep?.('plan');
  let planned = await plan();
  let by = planned.by;
  let sb = planned.storyboard;
  ev.onStoryboard?.(sb);
  const relook = async () => {
    const next = await ev.look?.();
    if (!next) return;
    pack = packFor(next.style, input.type);
    ({ pace, mood } = next);
    if (sb.style !== pack.id) sb = { ...sb, style: pack.id };
  };
  const replan = async () => { ev.onStep?.('plan'); planned = await plan(); by = planned.by; sb = planned.storyboard; ev.onStoryboard?.(sb); };
  // The pause point: an edited storyboard replaces the plan; true when it changed.
  const pass = async (): Promise<boolean> => {
    if (!ev.gate) return false;
    const shown = sb;
    const g = await ev.gate(sb);
    if (g === 'replan') { await relook(); await replan(); return true; }
    await relook();
    if (g === shown) return false;
    sb = cleanStoryboard({ ...g, style: pack.id }, { media, logo });
    ev.onStoryboard?.(sb);
    return true;
  };
  const done = new Map<string, Record<string, SlotValue>>();   // kept across an edit for beats that did not change
  let words: Record<string, SlotValue>[] = [];
  fill: for (;;) {
    while (await pass()) { /* paused again on the new plan until it is let through */ }
    if (!sb.beats.length) throw new StoryboardFailed();
    ev.onStep?.('fill');
    words = [];
    const total = sb.beats.length;
    for (let i = 0; i < total; i++) {
      const beat = sb.beats[i]!;
      const key = `${beat.template}|${beat.line}`;
      let w = done.get(key);
      ev.onFilling?.(i, total);
      if (!w) {
        const r = await fillScene({ prompt: input.prompt, type: input.type, style: pack.id, storyboard: sb, index: i }, opts, { onRetry: ev.onRetry });
        by = r.by;
        w = r.slots;
        done.set(key, w);
      }
      words.push(w);
      ev.onFilled?.(i + 1, total);
      if (i < total - 1 && (await pass())) continue fill;
    }
    break;
  }

  const notices: AiStateId[] = [];
  const fitted = fitStoryboard(sb);
  if (fitted.cut) { sb = fitted.storyboard; notices.push('too-long'); }
  const assigned = assignMedia(sb.beats.map((b) => b.template), input.assets);
  let recipe = buildRecipe(sb, words.map((w, i) => ({ ...w, ...assigned[i] })), { ...input, style: pack.id, pace, mood }, id);

  ev.onStep?.('check');
  const fixes: string[] = [];
  const auto = () => {
    const f = autoFix(recipe, { brand: input.brand });
    recipe = f.recipe;
    fixes.push(...f.fixed.map((x) => x.note ?? '').filter(Boolean));
  };
  const refill = async (index: number, request: string): Promise<boolean> => {
    const s = recipe.scenes[index]!;
    const t = s.template && getSceneTemplate(s.template);
    if (!t) return false;
    try {
      const r = await fillScene({ prompt: input.prompt, type: input.type, style: pack.id, storyboard: sb, index, request, previous: s.slots }, opts);
      const slots = mergeSlots(t, r.slots, s.slots);
      if (JSON.stringify(slots) === JSON.stringify(s.slots)) return false;
      recipe = withSlots(recipe, index, slots, pack, input.brand);
      return true;
    } catch (e) { rethrowCancel(e); return false; }   // a failed fix keeps the scene as it was
  };
  auto();
  const failing = new Map<number, Set<string>>();
  for (const issue of check(recipe, { brand: input.brand })) {
    const why = WORD_FIXES[issue.kind];
    const index = recipe.scenes.findIndex((s) => s.id === issue.sceneId);
    if (!why || index < 0 || !recipe.scenes[index]!.template) continue;
    failing.set(index, (failing.get(index) ?? new Set()).add(why));
  }
  for (const [index, why] of failing) if (await refill(index, [...why].join(' '))) fixes.push(`Scene ${index + 1} rewritten to fit its template`);
  if (failing.size) auto();
  const settle = () => { const st = settleLayout(recipe, input.brand); recipe = st.recipe; fixes.push(...st.notes.filter((x) => !fixes.includes(x))); };
  settle();
  ev.onFixes?.(fixes);

  const model = await criticModel(input.settings, opts);
  let criticSkipped = criticSkip(input.critic, model);
  let critic: CriticRun | undefined;
  if (criticSkipped) ev.onCriticSkipped?.(criticSkipped, model.model);
  else {
    ev.onStep?.('critic');
    const scenes = criticScenes(recipe);
    ev.onCritic?.({ scenes, frames: scenes.length });
    try {
      // Sent to the model decided on above, so the frames go to the model that was checked for images.
      critic = await runCritic(recipe, ev.frames ?? ((r, t) => renderFrames(r, t)), { ...opts, ai: model.ai, provider: model.provider, model: model.model });
    } catch (e) {
      rethrowCancel(e);
      criticSkipped = 'critic-unreachable';
      ev.onCriticSkipped?.(criticSkipped, model.model);
    }
    if (critic?.notes.length) {
      for (const n of critic.notes) await refill(n.sceneIndex, `${n.problem} ${n.fix}`.trim());
      auto();
      settle();
    }
  }
  // The timing fixes lengthen scenes, so the clip is held to 60 s once more.
  if (totalMs(recipe.scenes) > MAX_CLIP_MS) {
    recipe = fitToMax(recipe);
    if (!notices.includes('too-long')) notices.push('too-long');
  }
  const issues = check(recipe, { brand: input.brand });
  return { recipe, by, storyboard: sb, fixes, issues, critic, criticSkipped, notices };
}

/** "Remake this scene": one fill call for that scene, its media kept. Throws AiError (scene-remake-failed). */
export async function regenerateScene(recipe: Recipe, index: number, request?: string, opts: AiOptions & { brand?: BrandKit } = {}): Promise<Recipe> {
  const { brand, ...ai } = opts;
  const s = recipe.scenes[index];
  const t = s?.template && getSceneTemplate(s.template);
  if (!s || !t) throw new AiError('invalid-reply', 'make', { problems: ['That scene has no template.'] });
  const pack = packFor(recipe.style, recipe.type);
  const r = await fillScene({ prompt: recipe.prompt ?? recipe.name, type: recipe.type, style: pack.id, storyboard: storyboardOf(recipe), index, request, previous: s.slots }, ai);
  return withSlots(recipe, index, mergeSlots(t, r.slots, s.slots), pack, brand);
}

/** A new look with the same words: re-expands every templated scene in the pack; pace rescales lengths, held to 60 s. No AI call. */
export function restyle(recipe: Recipe, style: StyleId, pace: Pace, brand?: BrandKit): Recipe {
  const pack = getPack(style);
  if (!pack) throw new Error(`Motikord has no style called ${style}`);
  const k = paceMs(pace).sceneMs / paceMs(recipe.pace ?? 'normal').sceneMs;
  const scenes = recipe.scenes.map((s, i) => {
    if (!s.template) return s;
    const next: Scene = { ...s, durationMs: Math.max(1000, Math.round((s.durationMs * k) / 50) * 50) };
    if (i > 0) next.transition = transitionFor(pack, i, pace);
    else delete next.transition;
    return expandScene(next, pack, brand);
  });
  return fitToMax(toV2({ ...recipe, style, pace, scenes }));
}
