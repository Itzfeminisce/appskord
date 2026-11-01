import { canSeeImages } from '@appskord/llm';
import type { AiMode, CriticNote, Provider, Recipe, Settings } from '../types';
import { chat, FALLBACK_MODEL, LLMError } from '../llm';
import { getSceneTemplate } from '../templates/scenes';
import { toAiError } from './errors';
import { criticSystem } from './prompts';
import { parseJsonReply, type AiOptions } from './writeRecipe';

export const CRITIC_TOKENS = 600;
export const MAX_FRAMES = 4;

/** Why the visual check did not run (StatesMakeV2). */
export type CriticSkip = 'critic-off' | 'critic-not-available' | 'critic-unreachable';
/** Renders the frame at each time to a small JPEG data URL. */
export type FrameRenderer = (recipe: Recipe, timesMs: number[]) => Promise<string[]>;
export interface CriticModel { ai: AiMode; provider: Provider; model: string }
export interface CriticRun { notes: CriticNote[]; scenes: number[]; frames: number }

/** The model the make talks to, which is the one the critic asks. */
export function criticModel(settings: Pick<Settings, 'ai' | 'provider' | 'models'>, opts: Pick<AiOptions, 'ai' | 'provider' | 'model'> = {}): CriticModel {
  const ai = opts.ai ?? settings.ai;
  const provider = opts.provider ?? settings.provider;
  return { ai, provider, model: opts.model ?? settings.models[provider] ?? FALLBACK_MODEL[provider] };
}

/** Skipped when it is off, or when the model can't take images (Chrome's built-in AI never can). */
export function criticSkip(on: boolean, m: CriticModel): CriticSkip | undefined {
  if (!on) return 'critic-off';
  if (m.ai === 'local' || !canSeeImages(m.provider, m.model)) return 'critic-not-available';
  return undefined;
}

const wordCount = (slots: Recipe['scenes'][number]['slots']) =>
  Object.values(slots ?? {}).reduce<number>((n, v) => n + (typeof v === 'string' ? v.split(/\s+/).length : Array.isArray(v) ? v.length * 2 : 0), 0);

/** 2 to 4 scenes to look at: all of a short clip; else the first, the last and the two wordiest between. */
export function criticScenes(recipe: Recipe): number[] {
  const n = recipe.scenes.length;
  if (n <= MAX_FRAMES) return recipe.scenes.map((_, i) => i);
  const middle = recipe.scenes.map((s, i) => ({ i, w: wordCount(s.slots) })).slice(1, -1).sort((a, b) => b.w - a.w || a.i - b.i);
  return [0, ...middle.slice(0, MAX_FRAMES - 2).map((m) => m.i), n - 1].sort((a, b) => a - b);
}

/** Each scene once its motion has settled: 60% of the way through. */
export function frameTimes(recipe: Recipe, scenes: number[]): number[] {
  const starts: number[] = [];
  recipe.scenes.reduce((t, s) => { starts.push(t); return t + s.durationMs; }, 0);
  return scenes.map((i) => starts[i]! + Math.min(recipe.scenes[i]!.durationMs - 1, Math.round(recipe.scenes[i]!.durationMs * 0.6)));
}

/** Reads the critic's notes: scenes are numbered from 1 in the reply; only scenes it was shown count, one note each. */
export function readCriticNotes(raw: unknown, shown: number[]): CriticNote[] {
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { notes?: unknown }).notes) ? (raw as { notes: unknown[] }).notes : [];
  const out: CriticNote[] = [];
  for (const n of list) {
    if (typeof n !== 'object' || n === null) continue;
    const o = n as Record<string, unknown>;
    const sceneIndex = Number(o.scene) - 1;
    const problem = typeof o.problem === 'string' ? o.problem.trim().slice(0, 160) : '';
    const fix = typeof o.fix === 'string' ? o.fix.trim().slice(0, 200) : '';
    if (!shown.includes(sceneIndex) || !fix || out.some((x) => x.sceneIndex === sceneIndex)) continue;
    out.push({ sceneIndex, problem, fix });
  }
  return out;
}

const listScenes = (n: number[]) => {
  const s = n.map((i) => String(i + 1));
  return s.length < 2 ? s.join('') : `${s.slice(0, -1).join(', ')} and ${s.at(-1)}`;
};

/** Sends a few small frames to the same model and returns its per-scene notes. A garbled reply means no notes. */
export async function runCritic(recipe: Recipe, render: FrameRenderer, opts: AiOptions = {}): Promise<CriticRun> {
  const scenes = criticScenes(recipe);
  const images = await render(recipe, frameTimes(recipe, scenes));
  const words = scenes.map((i) => {
    const s = recipe.scenes[i]!;
    return `Scene ${i + 1}, ${getSceneTemplate(s.template ?? '')?.name ?? 'Free layers'}: ${JSON.stringify(s.slots ?? {})}`;
  });
  try {
    const reply = await chat([
      { role: 'system', content: criticSystem() },
      { role: 'user', content: `Frames of scenes ${listScenes(scenes)}, in order. Size ${recipe.aspect}.\n${words.join('\n')}`, images },
    ], { ...opts, json: true, maxTokens: CRITIC_TOKENS, temperature: 0.2 });
    return { notes: readCriticNotes(parseJsonReply(reply.text), scenes), scenes, frames: images.length };
  } catch (e) {
    if (e instanceof LLMError && e.code === 'bad-reply') return { notes: [], scenes, frames: images.length };
    throw toAiError(e, 'make');
  }
}
