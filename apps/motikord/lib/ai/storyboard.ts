import type { Aspect, Beat, ClipType, Pace, Provider, StyleId, Storyboard, TemplateId } from '../types';
import { chat, LLMError, type ChatMessage } from '../llm';
import { cutWords } from '../templates/expand';
import { paceMs } from '../templates/pick';
import { getPack, getSceneTemplate, isTemplateId, SCENE_TEMPLATES } from '../templates/scenes';
import { toAiError } from './errors';
import { SCENE_RANGE, STORYBOARD_REPAIR, storyboardSystem, targetMs } from './prompts';
import { parseJsonReply, type AiOptions } from './writeRecipe';

export const STORYBOARD_TOKENS = 1200;
/** StoryboardEdit counts a beat's line out of 10 words. */
export const LINE_WORDS = 10;
const PROMPT_CHARS = 4000;

/** The storyboard reply made no sense twice ("Couldn't plan the story"). */
export class StoryboardFailed extends Error {
  constructor() { super('Motikord could not plan the story'); this.name = 'StoryboardFailed'; }
}

export interface StoryboardInput {
  prompt: string; type: ClipType; aspect: Aspect; style: StyleId; pace: Pace; lengthMs?: number;
  media: number;          // attached photos and videos: templates that need one are offered only when there is one
  logo: boolean;          // a logo to show: Logo sting is offered only then
}

/** Scenes for a clip type at a pace: its length over the pace's scene length, inside the type's range. */
export function sceneCount(type: ClipType, pace: Pace, lengthMs?: number): number {
  const [lo, hi] = SCENE_RANGE[type];
  return Math.max(lo, Math.min(hi, Math.round(targetMs({ type, lengthMs }) / paceMs(pace).sceneMs)));
}

/** A beat's length: the template's own length scaled by the pace (Normal keeps it). */
export function beatMs(template: TemplateId, pace: Pace): number {
  const base = getSceneTemplate(template)?.defaultMs ?? 3000;
  return Math.round((base * paceMs(pace).sceneMs) / 3000 / 50) * 50;
}

const NEEDS_MEDIA: readonly TemplateId[] = ['hero', 'split', 'before-after'];
// The closest template that needs nothing missing (PLAN: no free elements; pick the closest template).
const CLOSEST: Partial<Record<TemplateId, TemplateId>> = { hero: 'title-hook', split: 'big-statement', 'before-after': 'big-statement', 'logo-sting': 'big-statement' };

/** The templates this clip may use. */
export function allowedTemplates(input: Pick<StoryboardInput, 'media' | 'logo'>): TemplateId[] {
  return SCENE_TEMPLATES.map((t) => t.id).filter((id) =>
    !(NEEDS_MEDIA.includes(id) && input.media < (id === 'before-after' ? 2 : 1)) && !(id === 'logo-sting' && !input.logo));
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

/** Reads a storyboard reply: known templates only (others become the closest allowed one), lines cut to 10 words. */
export function readStoryboard(raw: unknown, input: StoryboardInput): Storyboard | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.beats) ? r.beats : Array.isArray(r.scenes) ? r.scenes : undefined;
  if (!list) return undefined;
  const allowed = allowedTemplates(input);
  const max = SCENE_RANGE[input.type][1];
  const beats: Beat[] = [];
  for (const b of list) {
    if (typeof b !== 'object' || b === null) continue;
    const o = b as Record<string, unknown>;
    const line = cutWords(text(o.line ?? o.headline, 200), LINE_WORDS);
    if (!line) continue;
    let template: TemplateId = isTemplateId(o.template) ? o.template : 'big-statement';
    if (!allowed.includes(template)) template = CLOSEST[template] ?? 'big-statement';
    beats.push({ template, line, ms: beatMs(template, input.pace) });
    if (beats.length === max) break;
  }
  if (!beats.length) return undefined;
  return { name: text(r.name, 40) || cutWords(beats[0]!.line, 4), hook: text(r.hook, 120) || beats[0]!.line, style: input.style, beats };
}

export interface StoryboardResult { storyboard: Storyboard; plan: string; by: Provider | 'builtin' }

/** Storyboard call: a short plain-text plan, then the beats. Bad JSON gets one repair try, then StoryboardFailed. */
export async function planStoryboard(input: StoryboardInput, opts: AiOptions = {}): Promise<StoryboardResult> {
  const pack = getPack(input.style) ?? getPack('clean')!;
  const templates = allowedTemplates(input).map((id) => getSceneTemplate(id)!);
  const base: ChatMessage[] = [
    { role: 'system', content: storyboardSystem({ type: input.type, aspect: input.aspect, style: pack, pace: input.pace, scenes: sceneCount(input.type, input.pace, input.lengthMs), templates }) },
    { role: 'user', content: input.prompt.slice(0, PROMPT_CHARS) },
  ];
  let messages = base;
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply;
    try {
      reply = await chat(messages, { ...opts, maxTokens: STORYBOARD_TOKENS, temperature: 0.7 });
    } catch (e) {
      if (e instanceof LLMError && e.code === 'bad-reply') { messages = [...base, { role: 'user', content: STORYBOARD_REPAIR }]; continue; }
      throw toAiError(e, 'make');
    }
    const storyboard = readStoryboard(parseJsonReply(reply.text), input);
    if (storyboard) return { storyboard, plan: planText(reply.text), by: reply.by };
    messages = [...base, { role: 'assistant', content: reply.text.slice(0, 3000) }, { role: 'user', content: STORYBOARD_REPAIR }];
  }
  throw new StoryboardFailed();
}

/** The plain-words plan before the JSON. */
function planText(reply: string): string {
  const at = reply.search(/```|\{/);
  return (at < 0 ? '' : reply.slice(0, at)).trim().slice(0, 600);
}

/** A storyboard after edits: known templates, lines within 10 words, lengths at least a second. */
export function cleanStoryboard(sb: Storyboard): Storyboard {
  const beats = sb.beats
    .filter((b) => isTemplateId(b.template) && b.line.trim())
    .map((b) => ({ template: b.template, line: cutWords(b.line.trim(), LINE_WORDS), ms: Math.max(1000, Math.round(b.ms) || 3000) }));
  return { ...sb, beats };
}
