// Pure recipe edits behind the v3 editor's panels. Each takes a scene (or scenes) and returns it changed.
import { amountLabel, CAMERA_LABELS, ORBIT_SPAN } from '@appskord/motion/camera';
import { OVERLAP_MS, layerStarts } from '@appskord/motion/choreo';
import { FEEL, LINEAR } from '@appskord/motion/curves';
import type { Rect } from '@appskord/motion/physics';
import type { CameraMove, Curve, Feel, Key, LayerV3, SceneV3, Track } from '@appskord/motion/types';
import { moveTracks } from '../../lib/templates/v3/build';
import type { Move } from '../../lib/templates/v3/templates';

type Tracks = LayerV3['tracks'];

// ---- Motion tab: comes in, feel and curve, timing, type moves, while on screen, goes out.

export type ComesIn = 'rise' | 'word' | 'letter' | 'mask' | 'fill' | 'draw';
export const COMES_IN: readonly [ComesIn, string][] = [
  ['rise', 'Rise'],
  ['word', 'Per word'],
  ['letter', 'Per letter'],
  ['mask', 'Mask reveal'],
  ['fill', 'Scale to fill'],
  ['draw', 'Line draw'],
];
export type Hold = 'hold' | 'drift' | 'float';
export const HOLDS: readonly [Hold, string][] = [
  ['hold', 'Hold'],
  ['drift', 'Drift'],
  ['float', 'Float'],
];
export type GoesOut = 'carry' | 'fade' | 'mask' | 'none';
export const GOES_OUT: readonly [Exclude<GoesOut, 'none'>, string][] = [
  ['carry', 'Carry into next scene'],
  ['fade', 'Fade'],
  ['mask', 'Mask out'],
];
export const FEEL_NAMES: Readonly<Record<Feel, string>> = {
  smooth: 'Smooth',
  snappy: 'Snappy',
  bouncy: 'Bouncy',
  steady: 'Steady',
  floaty: 'Floaty',
};
export const FEEL_ORDER: readonly Feel[] = ['smooth', 'snappy', 'bouncy', 'steady', 'floaty'];

/** Drift moves this far over the hold, as the timeline reads "Drift · 2 px". */
export const DRIFT_PX = 2;
const FLOAT_PX = 4;
const FLOAT_MS = 1000;
/** A fade or mask out runs this long at the scene's end. */
export const OUT_MS = 400;

/** What the Motion tab shows for a layer. */
export interface MotionSpec {
  comesIn: ComesIn;
  curve: Curve;
  ms: number;
  weight?: [number, number];
  width?: [number, number];
  hold: Hold;
  out: GoesOut;
}

const MANAGED = ['opacity', 'y', 'mask', 'draw', 'scale', 'width'] as const;
const MOVE: Record<ComesIn, Move> = { rise: 'rise', word: 'rise', letter: 'rise', mask: 'wipe', fill: 'fill', draw: 'draw' };
const PRIMARY: Record<ComesIn, keyof Tracks> = { rise: 'y', word: 'y', letter: 'y', mask: 'mask', fill: 'scale', draw: 'draw' };

export function comesInOf(l: LayerV3): ComesIn {
  if (l.type?.fill) return 'fill';
  if (l.type?.unit === 'word') return 'word';
  if (l.type?.unit === 'letter') return 'letter';
  if (l.tracks.mask?.[0]?.v === 0) return 'mask';
  if (l.tracks.draw?.length && !l.count) return 'draw';
  return 'rise';
}

/** The curve the entrance lands with: the first key that names one. */
export function curveOf(l: LayerV3): Curve {
  for (const p of ['y', 'mask', 'draw', 'scale', 'opacity'] as const) {
    const c = l.tracks[p]?.find((k) => k.curve)?.curve;
    if (c) return c;
  }
  return FEEL.smooth.curve;
}

export function feelOf(c: Curve): Feel | undefined {
  return FEEL_ORDER.find((f) => JSON.stringify(FEEL[f].curve) === JSON.stringify(c));
}

/** The entrance length: when the comes-in move's second key lands. */
export function entranceMs(l: LayerV3): number {
  const t = l.tracks[PRIMARY[comesInOf(l)]] ?? l.tracks.opacity;
  return t?.[1]?.t ?? t?.[0]?.t ?? 0;
}

const span = (t: Track<number> | undefined): [number, number] | undefined =>
  t?.length ? [t[0]!.v, t[t.length - 1]!.v] : undefined;

/** The layer's ms on screen from its own start to the scene's end. */
export function localEnd(scene: SceneV3, l: LayerV3): number {
  const i = scene.layers.indexOf(l);
  const start = i < 0 ? (l.start ?? 0) : (layerStarts(scene.layers)[i] ?? 0);
  return Math.max(1, scene.ms - start);
}

export function readMotion(scene: SceneV3, l: LayerV3): MotionSpec {
  const ms = entranceMs(l);
  const y = l.tracks.y ?? [];
  const after = y.filter((k) => k.t > ms);
  const end = localEnd(scene, l);
  const op = l.tracks.opacity ?? [];
  const mask = l.tracks.mask ?? [];
  const out: GoesOut = l.carry
    ? 'carry'
    : op.length > 2 && op[op.length - 1]!.v === 0
      ? 'fade'
      : mask.length > 2 && mask[mask.length - 1]!.v === 0
        ? 'mask'
        : 'none';
  const outAt = end - (out === 'fade' || out === 'mask' ? OUT_MS : 0);
  const holdKeys = after.filter((k) => k.t <= outAt + 1);
  return {
    comesIn: comesInOf(l),
    curve: curveOf(l),
    ms,
    weight: span(l.tracks.weight),
    width: comesInOf(l) === 'fill' ? undefined : span(l.tracks.width),
    hold: holdKeys.length > 1 ? 'float' : holdKeys.length === 1 ? 'drift' : 'hold',
    out,
  };
}

const key = (t: number, v: number, curve?: Curve): Key<number> => (curve ? { t, v, curve } : { t, v });
const range = (a: number, b: number, ms: number, curve: Curve): Track<number> =>
  a === b ? [key(0, a)] : [key(0, a), key(ms, b, curve)];

/** Rewrites the layer's motion from a spec. Tracks the Motion tab does not own (x, rotate, extrude…) stay. */
export function writeMotion(scene: SceneV3, l: LayerV3, spec: MotionSpec, carryId?: string): LayerV3 {
  const ms = Math.max(40, Math.round(spec.ms));
  const tracks: Tracks = { ...l.tracks };
  for (const p of MANAGED) delete tracks[p];
  Object.assign(tracks, moveTracks(MOVE[spec.comesIn], ms, spec.curve));
  if (spec.weight) tracks.weight = range(spec.weight[0], spec.weight[1], ms, spec.curve);
  else delete tracks.weight;
  if (spec.width && spec.comesIn !== 'fill') tracks.width = range(spec.width[0], spec.width[1], ms, spec.curve);
  const next: LayerV3 = { ...l, tracks };
  if (l.kind === 'text') {
    if (spec.comesIn === 'word' || spec.comesIn === 'letter') next.type = { unit: spec.comesIn };
    else if (spec.comesIn === 'fill') next.type = { unit: l.type?.unit ?? 'line', fill: true };
    else delete next.type;
  }
  const end = localEnd(scene, next);
  const outAt = Math.max(ms + 1, end - (spec.out === 'fade' || spec.out === 'mask' ? OUT_MS : 0));
  const y = (tracks.y ??= [key(0, 0)]);
  const rest = y[y.length - 1]!.v;
  if (spec.hold === 'drift' && outAt > ms + 1) y.push(key(outAt, rest - DRIFT_PX, LINEAR));
  if (spec.hold === 'float' && outAt - ms > 2) {
    // At least two swings, about one a second, so a short hold still reads as floating.
    const n = Math.max(2, Math.floor((outAt - ms) / FLOAT_MS));
    for (let k = 1; k <= n; k++) y.push(key(Math.round(ms + ((outAt - ms) * k) / n), rest + (k % 2 ? -FLOAT_PX : FLOAT_PX), FEEL.steady.curve));
  }
  if (y.length === 1 && y[0]!.v === 0 && !l.tracks.y) delete tracks.y;
  if (spec.out === 'fade' && end > ms + OUT_MS) {
    const op = (tracks.opacity ??= [key(0, 1)]);
    op.push(key(Math.max(op[op.length - 1]!.t + 1, end - OUT_MS), 1), key(end, 0, spec.curve));
  }
  if (spec.out === 'mask' && end > ms + OUT_MS) {
    const m = (tracks.mask ??= [key(0, 1)]);
    m.push(key(Math.max(m[m.length - 1]!.t + 1, end - OUT_MS), 1), key(end, 0, spec.curve));
  }
  if (spec.out === 'carry') next.carry = carryId ?? l.carry ?? `carry-${scene.id}-${l.id}`;
  else delete next.carry;
  return next;
}

/** "Per word · Smooth · 0.6 s" under the layer's name. */
export function motionLine(scene: SceneV3, l: LayerV3): string {
  const m = readMotion(scene, l);
  const label = COMES_IN.find(([id]) => id === m.comesIn)![1];
  const feel = feelOf(m.curve);
  const curve = feel ? FEEL_NAMES[feel] : m.curve.kind === 'spring' ? `Spring · ${m.curve.bounce}% bounce` : 'Curve';
  return `${label} · ${curve} · ${(m.ms / 1000).toFixed(1)} s`;
}

/** "Carry into next scene": the layer and its match in the next scene share a carry id; the cut carries it. */
export function carryInto(scenes: SceneV3[], i: number, layerId: string): SceneV3[] {
  const a = scenes[i];
  const b = scenes[i + 1];
  const la = a?.layers.find((l) => l.id === layerId);
  if (!a || !b || !la) return scenes;
  const lb =
    b.layers.find((l) => la.carry && l.carry === la.carry) ??
    b.layers.find((l) => la.slotId && l.slotId === la.slotId) ??
    b.layers.find((l) => l.kind === la.kind);
  if (!lb) return scenes;
  const id = la.carry ?? lb.carry ?? `carry-${b.id}-${lb.id}`;
  la.carry = id;
  lb.carry = id;
  a.transition = { kind: 'carry', carry: [...new Set([...(a.transition.carry ?? []), id])] };
  return scenes;
}

/** Drops a layer's carry and every scene's link to it. */
export function dropCarry(scenes: SceneV3[], i: number, layerId: string): SceneV3[] {
  const la = scenes[i]?.layers.find((l) => l.id === layerId);
  const id = la?.carry;
  if (!la || !id) return scenes;
  delete la.carry;
  for (const s of scenes) {
    const left = (s.transition.carry ?? []).filter((c) => c !== id);
    if (s.transition.carry) s.transition = left.length ? { kind: s.transition.kind, carry: left } : { kind: s.transition.kind === 'carry' ? 'crossfade' : s.transition.kind };
  }
  const next = scenes[i + 1]?.layers.find((l) => l.carry === id);
  if (next && !scenes[i - 1]?.layers.some((l) => l.carry === id)) delete next.carry;
  return scenes;
}

/** Layers in the clip that move like this one: the same slot, else text of the same unit. */
export function similarLayers(scenes: readonly SceneV3[], i: number, l: LayerV3): { scene: number; id: string }[] {
  const out: { scene: number; id: string }[] = [];
  scenes.forEach((s, si) =>
    s.layers.forEach((x) => {
      if (si === i && x.id === l.id) return;
      const match = l.slotId ? x.slotId === l.slotId : x.kind === l.kind && x.kind === 'text' && !x.count;
      if (match) out.push({ scene: si, id: x.id });
    }),
  );
  return out;
}

/** "Starts" and "Length" inputs: "0.15 s" or "40 ms" to ms; undefined when it is not a number. */
export function parseMs(text: string): number | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s)?\s*$/.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'ms' ? n : n * 1000;
}
/** "400 → 700" to a range. */
export function parseRange(text: string): [number, number] | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:→|->|to)?\s*(\d+(?:\.\d+)?)?\s*$/.exec(text);
  if (!m) return undefined;
  const a = Number(m[1]);
  return [a, m[2] ? Number(m[2]) : a];
}
export const rangeText = (r?: [number, number]) => (r ? `${r[0]} → ${r[1]}` : '');

// ---- Keyframes on the timeline.

/** Every key time on the layer, sorted, for its row of diamonds. */
export function keyTimes(l: LayerV3): number[] {
  const set = new Set<number>();
  for (const t of Object.values(l.tracks)) for (const k of t ?? []) set.add(k.t);
  return [...set].sort((a, b) => a - b);
}

/** Moves every key at `from` to `to`, kept between its neighbours on each track and inside the scene. */
export function moveKey(l: LayerV3, from: number, to: number, sceneMs = Number.POSITIVE_INFINITY): LayerV3 {
  const end = sceneMs - (l.start ?? 0);
  const tracks: Tracks = {};
  for (const [p, track] of Object.entries(l.tracks) as [keyof Tracks, Track<number>][]) {
    tracks[p] = track.map((k, i) => {
      if (k.t !== from) return k;
      const lo = i > 0 ? track[i - 1]!.t + 1 : 0;
      const hi = i < track.length - 1 ? track[i + 1]!.t - 1 : end;
      return { ...k, t: Math.round(Math.min(hi, Math.max(lo, to))) };
    });
  }
  return { ...l, tracks };
}

// ---- Scene tab: camera and depth.

export const CAMERA_ORDER: readonly CameraMove[] = ['push-in', 'pull-out', 'pan', 'orbit', 'rack-focus', 'hold'];
/** The Amount slider's number: percent, or degrees for an orbit. */
export const amountValue = (move: CameraMove, amount: number) =>
  move === 'orbit' ? Math.round(Math.abs(amount) * ORBIT_SPAN) : Math.round(Math.abs(amount) * 100);
export const amountFrom = (move: CameraMove, value: number) =>
  Math.max(-1, Math.min(1, move === 'orbit' ? value / ORBIT_SPAN : value / 100));
/** "Camera: Push in 4%", as ChangesV3 lists it. */
export const cameraSummary = (move: CameraMove, amount: number) =>
  move === 'hold' || move === 'rack-focus' ? `Camera: ${CAMERA_LABELS[move]}` : `Camera: ${CAMERA_LABELS[move]} ${amountLabel(move, amount)}`;

// ---- Layer tab: physics and particles inputs from the scene's words.

const FRAME = { w: 1080, h: 1920 };

/** The words' boxes, recipe px from the frame's centre, for particles and falling layers to hit. */
export function wordBoxes(scene: SceneV3, text: (l: LayerV3) => string | undefined, fontSize = 72): Rect[] {
  return scene.layers.flatMap((l) => {
    if (l.kind !== 'text') return [];
    const words = text(l);
    if (!words) return [];
    const lines = words.split('\n');
    const w = Math.min(FRAME.w - 80, Math.max(...lines.map((s) => s.length)) * fontSize * 0.55);
    const y = l.tracks.y?.[l.tracks.y.length - 1]?.v ?? 0;
    const x = l.tracks.x?.[l.tracks.x.length - 1]?.v ?? 0;
    return [{ x, y, w, h: lines.length * fontSize * 1.1 }];
  });
}
/** The floor a falling layer lands on: the frame's bottom edge. */
export const FLOOR: Rect = { x: 0, y: FRAME.h / 2 + 20, w: FRAME.w * 2, h: 40 };
export const FRAME_SIZE = FRAME;

export const OVERLAP = OVERLAP_MS;
