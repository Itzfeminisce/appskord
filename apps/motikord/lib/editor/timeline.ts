import { MAX_CLIP_MS } from '../recipe/validate';
import { clipDuration } from '../render/drawFrame';
import type { Layer, PatchOp, Recipe } from '../types';
import { clock, sceneStart, type Edit } from './store';

// Timeline maths, pure: bars snap, stay inside their scene and never make a recipe the validator refuses.

/** The shortest a layer or a scene can be trimmed to. */
export const MIN_LAYER_MS = 100;
export const MIN_SCENE_MS = 500;
/** Times land on tenths of a second, as the Layer tab shows them. */
export const GRID_MS = 100;

export type DragMode = 'move' | 'start' | 'end';
export interface Span { startMs: number; endMs: number }

export interface Track { name: string; bars: { si: number; li: number; layer: Layer }[] }

/** One track per layer name, top layer first, so "Title" in every scene sits on one row. */
export function tracks(r: Recipe): Track[] {
  const out = new Map<string, Track>();
  r.scenes.forEach((scene, si) => {
    for (let li = scene.layers.length - 1; li >= 0; li--) {
      const layer = scene.layers[li]!;
      const t = out.get(layer.name) ?? { name: layer.name, bars: [] };
      t.bars.push({ si, li, layer });
      out.set(layer.name, t);
    }
  });
  return [...out.values()];
}

/** Rounds to the grid, then pulls onto the nearest target (scene edges, other bars, the playhead) within tolMs. */
export function snap(ms: number, targets: readonly number[] = [], tolMs = 0): number {
  return snapTo(ms, targets, tolMs).ms;
}
const toGrid = (ms: number) => Math.round(ms / GRID_MS) * GRID_MS;
function snapTo(ms: number, targets: readonly number[], tolMs: number): { ms: number; gap: number } {
  let best = { ms: toGrid(ms), gap: Infinity };
  for (const t of targets) {
    const d = Math.abs(t - ms);
    // Targets such as the playhead fall between grid lines; the snapped time still lands on the grid.
    if (d <= tolMs && d < best.gap) best = { ms: toGrid(t), gap: d };
  }
  return best;
}

/**
 * Where a layer bar lands after a drag of deltaMs (scene-relative times).
 * Moving keeps its length; trimming keeps MIN_LAYER_MS; both stay inside the scene.
 */
export function dragSpan(span: Span, mode: DragMode, deltaMs: number, sceneMs: number, targets: readonly number[] = [], tolMs = 0): Span {
  const len = span.endMs - span.startMs;
  if (mode === 'move') {
    const rawStart = span.startMs + deltaMs;
    // Snap whichever edge is nearer a target, then keep the length.
    const s = snapTo(rawStart, targets, tolMs);
    const e = snapTo(rawStart + len, targets, tolMs);
    let start = e.gap < s.gap ? e.ms - len : s.ms;
    start = Math.max(0, Math.min(start, sceneMs - len));
    return { startMs: start, endMs: start + len };
  }
  if (mode === 'start') {
    const start = Math.max(0, Math.min(snap(span.startMs + deltaMs, targets, tolMs), span.endMs - MIN_LAYER_MS));
    return { startMs: start, endMs: span.endMs };
  }
  const end = Math.min(sceneMs, Math.max(snap(span.endMs + deltaMs, targets, tolMs), span.startMs + MIN_LAYER_MS));
  return { startMs: span.startMs, endMs: end };
}

/** Snap targets inside one scene: its edges and the edges of its other layers. */
export function sceneTargets(r: Recipe, si: number, exceptLayerId?: string): number[] {
  const scene = r.scenes[si];
  if (!scene) return [];
  const out = [0, scene.durationMs];
  for (const l of scene.layers) if (l.id !== exceptLayerId) out.push(l.startMs, l.endMs);
  return out;
}

/** The Change a layer drag makes, or undefined when it lands where it started. */
export function layerTiming(r: Recipe, si: number, li: number, raw: Span): Edit | undefined {
  const layer = r.scenes[si]?.layers[li];
  const span = { startMs: toGrid(raw.startMs), endMs: Math.min(toGrid(raw.endMs), r.scenes[si]?.durationMs ?? Infinity) };
  if (!layer || (layer.startMs === span.startMs && layer.endMs === span.endMs)) return undefined;
  const path = `/scenes/${si}/layers/${li}`;
  const at = sceneStart(r, si);
  return {
    ops: [{ op: 'replace', path: `${path}/startMs`, value: span.startMs }, { op: 'replace', path: `${path}/endMs`, value: span.endMs }],
    summary: `${layer.name} ${clock(at + span.startMs)}–${clock(at + span.endMs)}`,
  };
}

/** The length a scene's end edge can be dragged to: at least MIN_SCENE_MS, its layers' starts, and the clip limit. */
export function sceneLength(r: Recipe, si: number, wantMs: number): number {
  const scene = r.scenes[si];
  if (!scene) return 0;
  const floor = Math.max(MIN_SCENE_MS, ...scene.layers.map((l) => l.startMs + MIN_LAYER_MS));
  const ceiling = MAX_CLIP_MS - (clipDuration(r) - scene.durationMs);
  return Math.max(Math.ceil(floor / GRID_MS) * GRID_MS, Math.min(snap(wantMs), Math.floor(ceiling / GRID_MS) * GRID_MS));
}

/** Trims a scene; layers that ran to or past the old end follow the new end. */
export function sceneTiming(r: Recipe, si: number, wantMs: number): Edit | undefined {
  const scene = r.scenes[si];
  if (!scene) return undefined;
  const ms = sceneLength(r, si, wantMs);
  if (ms === scene.durationMs) return undefined;
  const ops: PatchOp[] = [{ op: 'replace', path: `/scenes/${si}/durationMs`, value: ms }];
  scene.layers.forEach((l, li) => {
    const end = l.endMs >= scene.durationMs || l.endMs > ms ? ms : l.endMs;
    if (end !== l.endMs) ops.push({ op: 'replace', path: `/scenes/${si}/layers/${li}/endMs`, value: end });
  });
  return { ops, summary: `Scene ${si + 1} ${(ms / 1000).toFixed(1)} s` };
}

/** Ruler labels every step ms, up to the clip's end. */
export function ticks(totalMs: number, stepMs = 5000): number[] {
  const out: number[] = [];
  for (let t = 0; t <= totalMs; t += stepMs) out.push(t);
  return out;
}
