// Caption text layers written into the recipe, as one undoable change. Pure over the editor state.
import type { LayerV3, SceneV3 } from '@appskord/motion/types';
import { validateScene } from '@appskord/motion/recipe';
import type { CaptionCue } from '../../lib/voice/captions';
import type { Layer, PatchOp, TextLayer } from '../../lib/types';
import { applyOps, sceneStarts, type V3State } from './model';

export type CaptionStyle = 'pop' | 'line' | 'karaoke' | 'boxed';
export const CAPTION_STYLES: readonly [CaptionStyle, string][] = [
  ['pop', 'Word pop'],
  ['line', 'Line'],
  ['karaoke', 'Karaoke'],
  ['boxed', 'Boxed'],
];
export const CAPTION_POSITION = 'Bottom safe area';
export const CAPTION_PREFIX = 'caption-';
const FADE_MS = 150;

const isCaption = (id: string) => id.startsWith(CAPTION_PREFIX);

/** The caption layers of every scene: a cue is cut at scene edges so each piece lives in one scene. */
export function captionPieces(starts: number[], sceneMs: number[], cues: readonly CaptionCue[]): { scene: number; startMs: number; endMs: number; text: string }[] {
  const out: { scene: number; startMs: number; endMs: number; text: string }[] = [];
  for (const cue of cues) {
    for (let i = 0; i < starts.length; i++) {
      const a = Math.max(cue.startMs, starts[i]!);
      const b = Math.min(cue.endMs, starts[i]! + sceneMs[i]!);
      if (b - a >= 100) out.push({ scene: i, startMs: a - starts[i]!, endMs: b - starts[i]!, text: cue.text });
    }
  }
  return out;
}

function pair(n: number, scene: number, p: { startMs: number; endMs: number; text: string }, style: CaptionStyle, font: string): { v2: TextLayer; v3: LayerV3 } {
  const id = `${CAPTION_PREFIX}${scene + 1}-${n}`;
  const hold = Math.max(p.endMs - p.startMs - FADE_MS, FADE_MS);
  const unit = style === 'pop' || style === 'karaoke' ? 'word' : 'line';
  const v2: TextLayer = {
    id, name: 'Caption', type: 'text', role: 'caption', text: p.text, startMs: p.startMs, endMs: p.endMs,
    box: { x: 0.08, y: 0.72, w: 0.84, h: 0.14 }, opacity: 1, font, sizePx: 44, weight: 700, colour: '#FFFFFF', align: 'center', lineHeight: 1.15,
    shadow: true, ...(style === 'boxed' ? { background: 'rgba(17,17,20,0.72)', pill: true } : {}),
    ...(style === 'karaoke' ? { highlight: { word: 0, colour: '#F9A8D4' } } : {}),
  };
  const v3: LayerV3 = {
    id, kind: 'text', depth: 'front', start: p.startMs, slotId: id, type: { unit },
    tracks: { opacity: [{ t: 0, v: 0 }, { t: FADE_MS, v: 1 }, { t: hold, v: 1 }, { t: hold + FADE_MS, v: 0 }] },
  };
  return { v2, v3 };
}

/** Replaces the clip's caption layers with these cues. Nothing changes when a scene would fail the recipe check. */
export function writeCaptions(st: V3State, cues: readonly CaptionCue[], style: CaptionStyle, summary: string): V3State {
  const scenes = st.clip.v3.scenes;
  const pieces = captionPieces(sceneStarts(st.clip.v3), scenes.map((s) => s.ms), cues);
  const font = st.clip.recipe.scenes.flatMap((s) => s.layers).find((l): l is TextLayer => l.type === 'text')?.font ?? 'Geist';
  const ops: PatchOp[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const mine = pieces.filter((p) => p.scene === i).map((p, n) => pair(n + 1, i, p, style, font));
    const v3Old = scenes[i]!.layers;
    const v2Old = st.clip.recipe.scenes[i]?.layers ?? [];
    if (!mine.length && !v3Old.some((l) => isCaption(l.id))) continue;
    const v3Layers = [...v3Old.filter((l) => !isCaption(l.id)), ...mine.map((m) => m.v3)];
    const scene: SceneV3 = { ...scenes[i]!, layers: v3Layers };
    const checked = validateScene(scene);
    if (!checked.ok) return { ...st, errors: checked.errors };
    ops.push({ op: 'replace', path: `/v3/scenes/${i}/layers`, value: v3Layers });
    if (st.clip.recipe.scenes[i]) {
      const v2Layers: Layer[] = [...v2Old.filter((l) => !isCaption(l.id)), ...mine.map((m) => m.v2)];
      ops.push({ op: 'replace', path: `/recipe/scenes/${i}/layers`, value: v2Layers });
    }
  }
  return ops.length ? applyOps(st, ops, { summary }) : st;
}

export const hasCaptions = (st: V3State) => st.clip.v3.scenes.some((s) => s.layers.some((l) => isCaption(l.id)));

/** The words of every text layer, in scene order: the script the voice reads. */
export function scriptOf(st: V3State, text: (scene: number, layer: LayerV3) => string | undefined): string {
  const parts: string[] = [];
  st.clip.v3.scenes.forEach((s, i) => {
    for (const l of s.layers) {
      if (l.kind !== 'text' || isCaption(l.id)) continue;
      const t = text(i, l)?.replace(/\s+/g, ' ').trim();
      if (t) parts.push(/[.!?]$/.test(t) ? t : `${t}.`);
    }
  });
  return parts.join(' ');
}
