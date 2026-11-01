import type { Asset, ClipType, Provider, Recipe, SceneTemplate, SlotValue, StyleId, Storyboard, TemplateId, TextLayer } from '../types';
import { chat, LLMError, type ChatMessage } from '../llm';
import { getPack, getSceneTemplate } from '../templates/scenes';
import { AiError, toAiError } from './errors';
import { pickExamples } from './examples';
import { fillRetryMessage, fillSystem } from './prompts';
import { CALL_BUDGET, estimateTokens, parseJsonReply, type AiOptions } from './writeRecipe';

export const SCENE_TOKENS = 700;
const PROMPT_CHARS = 1500;

export interface FillInput {
  prompt: string; type: ClipType; style: StyleId; storyboard: Storyboard; index: number;
  request?: string;                          // a fix or "Remake this scene" ask
  previous?: Record<string, SlotValue>;      // the scene's words now, when it is being remade
}
export interface FillResult { slots: Record<string, SlotValue>; by: Provider | 'builtin' }
export interface FillHooks { onRetry?: (index: number) => void }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : typeof v === 'number' ? String(v) : '');

/** Reads the slots a fill reply wrote for a template. Media and logo slots are left to the caller. */
export function readSlots(raw: unknown, t: SceneTemplate): { slots: Record<string, SlotValue>; problems: string[] } {
  const src = isObj(raw) && isObj(raw.slots) ? raw.slots : isObj(raw) ? raw : undefined;
  if (!src) return { slots: {}, problems: ['The reply was not a JSON object with "slots".'] };
  const slots: Record<string, SlotValue> = {};
  const problems: string[] = [];
  for (const d of t.slots) {
    if (d.kind === 'media' || d.kind === 'logo') continue;
    const v = src[d.id];
    const [lo, hi] = d.items ?? [1, 8];
    if (d.kind === 'items') {
      const list = Array.isArray(v) ? v.map(str).filter(Boolean).slice(0, hi) : [];
      if (list.length) slots[d.id] = list;
      if (!d.optional && list.length < lo) problems.push(`"${d.id}" needs ${lo} to ${hi} items.`);
    } else if (d.kind === 'chart') {
      const bars = Array.isArray(v)
        ? v.filter(isObj).map((b) => ({ label: str(b.label), value: Number(b.value) })).filter((b) => b.label && Number.isFinite(b.value)).slice(0, hi)
        : [];
      if (bars.length) slots[d.id] = bars;
      if (!d.optional && bars.length < lo) problems.push(`"${d.id}" needs ${lo} to ${hi} bars with a label and a number.`);
    } else {
      const s = str(v);
      if (s) slots[d.id] = s;
      else if (!d.optional) problems.push(`"${d.id}" is missing.`);
    }
  }
  return { slots, problems };
}

const show = (slots: Record<string, SlotValue>) => JSON.stringify({ slots });

/** The fill call's messages: the slot rules, the nearest worked examples, then this scene in its story. */
export function fillMessages(input: FillInput): ChatMessage[] {
  const beat = input.storyboard.beats[input.index]!;
  const t = getSceneTemplate(beat.template)!;
  const pack = getPack(input.style) ?? getPack('clean')!;
  const messages: ChatMessage[] = [{ role: 'system', content: fillSystem(t, input.type, pack) }];
  for (const e of pickExamples(input.type, beat.template, input.style)) {
    const et = getSceneTemplate(e.template)!;
    messages.push({ role: 'user', content: `Example. ${e.type} clip, ${et.name} scene: ${e.line}` });
    messages.push({ role: 'assistant', content: show(e.slots) });
  }
  const beats = input.storyboard.beats;
  const words = input.previous ? Object.fromEntries(Object.entries(input.previous).filter(([id]) => t.slots.some((d) => d.id === id && d.kind !== 'media' && d.kind !== 'logo'))) : undefined;
  messages.push({
    role: 'user',
    content: [
      `Idea: ${input.prompt.slice(0, PROMPT_CHARS)}`,
      `Clip: ${input.storyboard.name}. Hook: ${input.storyboard.hook}`,
      `Scene ${input.index + 1} of ${beats.length}, ${t.name}: ${beat.line}`,
      input.index > 0 ? `Scene before: ${beats[input.index - 1]!.line}` : '',
      input.index < beats.length - 1 ? `Scene after: ${beats[input.index + 1]!.line}` : '',
      words && Object.keys(words).length ? `Its words now: ${show(words)}` : '',
      input.request ? `Change: ${input.request.slice(0, 400)}` : '',
    ].filter(Boolean).join('\n'),
  });
  return messages;
}

/** One call fills one scene's slots. A garbled reply is asked again once (`scene-retrying`), then the make fails. */
export async function fillScene(input: FillInput, opts: AiOptions = {}, hooks: FillHooks = {}): Promise<FillResult> {
  const beat = input.storyboard.beats[input.index];
  const t = beat && getSceneTemplate(beat.template);
  if (!t) throw new AiError('invalid-reply', 'make', { problems: ['The scene has no template.'] });
  const base = fillMessages(input);
  let messages = base;
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1) hooks.onRetry?.(input.index);
    let reply;
    try {
      reply = await chat(messages, { ...opts, json: true, maxTokens: SCENE_TOKENS, temperature: 0.6 });
    } catch (e) {
      if (e instanceof LLMError && e.code === 'bad-reply') { problems = ['The reply was not JSON.']; messages = [...base, { role: 'user', content: fillRetryMessage(problems) }]; continue; }
      throw toAiError(e, 'make');
    }
    const read = readSlots(parseJsonReply(reply.text), t);
    if (!read.problems.length) return { slots: read.slots, by: reply.by };
    problems = read.problems;
    const withReply: ChatMessage[] = [...base, { role: 'assistant', content: reply.text.slice(0, 1500) }, { role: 'user', content: fillRetryMessage(problems) }];
    messages = estimateTokens(withReply) + SCENE_TOKENS <= CALL_BUDGET ? withReply : [...base, { role: 'user', content: fillRetryMessage(problems) }];
  }
  throw new AiError('invalid-reply', 'make', { problems });
}

/** The storyboard a finished recipe tells: each templated scene's template, first words and length. */
export function storyboardOf(recipe: Recipe): Storyboard {
  const beats = recipe.scenes.map((s) => {
    const t = s.template ? getSceneTemplate(s.template) : undefined;
    const first = t?.slots.find((d) => d.kind === 'text' && typeof s.slots?.[d.id] === 'string');
    const words = s.layers.find((l): l is TextLayer => l.type === 'text');
    const line = first ? String(s.slots![first.id]) : (words?.text ?? '');
    return { template: (s.template ?? 'big-statement') as TemplateId, line, ms: s.durationMs };
  });
  return { name: recipe.name, hook: beats[0]?.line ?? recipe.name, style: recipe.style ?? 'clean', beats };
}

/** Media and logo slots keep what the scene had; text slots take the new words. */
export function mergeSlots(t: SceneTemplate, words: Record<string, SlotValue>, kept: Record<string, SlotValue> = {}): Record<string, SlotValue> {
  const out: Record<string, SlotValue> = { ...words };
  for (const d of t.slots) if ((d.kind === 'media' || d.kind === 'logo') && kept[d.id] !== undefined) out[d.id] = kept[d.id]!;
  return out;
}

/** Hands attached photos and videos to the media slots in story order, each once while there are unused ones. */
export function assignMedia(templates: TemplateId[], assets: Asset[]): Record<string, SlotValue>[] {
  const media = assets.filter((a) => a.kind === 'image' || a.kind === 'video');
  const logo = assets.find((a) => a.kind === 'logo');
  let next = 0;
  return templates.map((id) => {
    const out: Record<string, SlotValue> = {};
    for (const d of getSceneTemplate(id)?.slots ?? []) {
      if (d.kind === 'logo' && logo) out[d.id] = { assetId: logo.id };
      if (d.kind !== 'media' || !media.length) continue;
      if (d.optional && next >= media.length) continue;
      out[d.id] = { assetId: media[next % media.length]!.id };
      next++;
    }
    return out;
  });
}
