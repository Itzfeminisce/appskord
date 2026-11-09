// "Animate this layer": only the layer's settings go to the AI, never media or its words. The reply is tracks,
// checked by validateScene before the layer changes.
import { estimateTokens } from '@appskord/llm';
import { FEEL } from '@appskord/motion/curves';
import { validateScene } from '@appskord/motion/recipe';
import { FEELS, PROPS, UNITS, type Curve, type Feel, type LayerV3, type SceneV3, type Unit } from '@appskord/motion/types';
import { toAiError } from '../../ai/errors';
import { CALL_BUDGET, parseJsonReply, type AiOptions } from '../../ai/writeRecipe';
import { chat, type ChatMessage } from '../../llm';
import { PROVIDERS } from '../../providers';
import type { Layer } from '../../types';
import { stateCopy, type StateCopy } from './states';

export const ANIMATE_TOKENS = 900;
export const ANIMATE = {
  title: 'Animate this layer',
  ask: 'Describe the motion',
  go: 'Animate',
  undoNote: 'You can undo it.',
  privacy: (provider: string) => `Only this layer’s settings go to ${provider}, never your media.`,
  done: (name: string) => `${name} animated`,
  undo: 'Undo',
  keep: 'Keep',
} as const;

export interface AnimateInput {
  scene: SceneV3;
  layerId: string;
  /** What the user typed: "Drop and settle". */
  words: string;
  /** The layer's label: "Headline". */
  name: string;
  /** The v2 layer behind it, for its type settings. Its text, media and colours are never sent. */
  v2?: Layer;
}
export type AnimateResult =
  | { ok: true; scene: SceneV3; layer: LayerV3; title: string; line: string; tokens: number }
  | { ok: false; state: 'animate-layer-failed' | 'animate-layer-unclear'; copy: StateCopy; tokens: number };

const count = (s: string, re: RegExp) => s.split(re).filter(Boolean).length;

/** The settings the AI sees: shape and timing only. */
export function layerSettings(scene: SceneV3, layer: LayerV3, v2?: Layer): Record<string, unknown> {
  const out: Record<string, unknown> = {
    kind: layer.kind,
    depth: layer.depth,
    start: layer.start ?? 0,
    sceneMs: scene.ms,
    tracks: layer.tracks,
  };
  if (layer.type) out.type = layer.type;
  if (layer.count) out.count = layer.count;
  if (v2?.type === 'text') {
    Object.assign(out, {
      role: v2.role,
      sizePx: v2.sizePx,
      weight: v2.weight,
      align: v2.align,
      words: count(v2.text, /\s+/),
      letters: count(v2.text, /\s*/),
    });
  }
  return out;
}

export function animateSystem(): string {
  return [
    'You animate one layer of a motion graphics scene. You see only its settings.',
    `Reply with JSON only: {"tracks":{prop:[{"t":ms,"v":number,"curve"?:curve}]},"unit"?:"letter"|"word"|"line"}.`,
    `Props: ${PROPS.join(', ')}. t is ms from the layer's start, each key later than the last; end before sceneMs.`,
    'curve is {"kind":"spring","bounce":0-100,"ms":n} or {"kind":"bezier","p":[x1,y1,x2,y2]}.',
    `Feels: ${FEELS.join(', ')}. opacity and draw run 0 to 1; x and y are px at 1080; scale 1 is the layer's size.`,
    'unit sets kinetic type for text: letters, words or lines enter one by one. Leave it out for other kinds.',
  ].join('\n');
}

function readTracks(raw: unknown): { tracks: LayerV3['tracks']; unit?: Unit } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as { tracks?: unknown; unit?: unknown };
  if (typeof o.tracks !== 'object' || o.tracks === null || !Object.keys(o.tracks).length) return undefined;
  const unit = (UNITS as readonly unknown[]).includes(o.unit) ? (o.unit as Unit) : undefined;
  return { tracks: o.tracks as LayerV3['tracks'], ...(unit ? { unit } : {}) };
}

const FEEL_LABEL: Record<Feel, string> = {
  smooth: 'Smooth',
  snappy: 'Snappy',
  bouncy: 'Bouncy',
  steady: 'Steady',
  floaty: 'Floaty',
};
const UNIT_LABEL: Record<Unit, string> = { letter: 'Per letter', word: 'Per word', line: 'Per line' };

function feelOf(curve: Curve | undefined): Feel {
  if (!curve) return 'smooth';
  if (curve.kind === 'spring') return 'bouncy';
  const match = FEELS.find((f) => {
    const c = FEEL[f].curve;
    return c.kind === 'bezier' && c.p.every((x, i) => x === curve.p[i]);
  });
  return match ?? 'smooth';
}

/** "Per letter, Bouncy, 0.8 s." */
export function animatedLine(layer: LayerV3): string {
  const keys = Object.values(layer.tracks).flatMap((t) => t ?? []);
  const curve = keys.find((k) => k.curve)?.curve;
  const s = Math.max(0, ...keys.map((k) => k.t)) / 1000;
  const parts = [layer.type ? UNIT_LABEL[layer.type.unit] : undefined, FEEL_LABEL[feelOf(curve)], `${s.toFixed(1)} s`];
  return `${parts.filter(Boolean).join(', ')}.`;
}

/** Asks the AI for the layer's tracks. The scene is only changed when the reply passes validateScene. */
export async function animateLayer(input: AnimateInput, opts: AiOptions = {}): Promise<AnimateResult> {
  const layer = input.scene.layers.find((l) => l.id === input.layerId);
  const provider = opts.ai === 'local' ? 'Built-in AI' : PROVIDERS[opts.provider ?? 'groq'].label;
  const messages: ChatMessage[] = [
    { role: 'system', content: animateSystem() },
    {
      role: 'user',
      content: `Layer settings: ${JSON.stringify(layer ? layerSettings(input.scene, layer, input.v2) : {})}\nMotion: ${input.words.trim().slice(0, 300)}`,
    },
  ];
  const tokens = estimateTokens(messages) + ANIMATE_TOKENS;
  const unclear = (): AnimateResult => ({
    ok: false,
    state: 'animate-layer-unclear',
    copy: stateCopy('animate-layer-unclear'),
    tokens,
  });
  if (!layer || !input.words.trim() || tokens > CALL_BUDGET) return unclear();
  let text: string;
  try {
    text = (await chat(messages, { ...opts, json: true, maxTokens: ANIMATE_TOKENS, temperature: 0.2 })).text;
  } catch (e) {
    const err = toAiError(e, 'edit');
    if (err.code === 'cancelled') throw err;
    if (err.code === 'bad-reply' || err.code === 'invalid-reply') return unclear();
    console.error('Motikord: could not animate layer', err);
    return { ok: false, state: 'animate-layer-failed', copy: stateCopy('animate-layer-failed', { provider }), tokens };
  }
  const read = readTracks(parseJsonReply(text));
  if (!read) return unclear();
  const next: LayerV3 = { ...layer, tracks: read.tracks };
  if (read.unit && layer.kind === 'text') next.type = { ...layer.type, unit: read.unit };
  const scene: SceneV3 = { ...input.scene, layers: input.scene.layers.map((l) => (l.id === layer.id ? next : l)) };
  if (!validateScene(scene).ok) return unclear();
  return { ok: true, scene, layer: next, title: ANIMATE.done(input.name), line: animatedLine(next), tokens };
}
