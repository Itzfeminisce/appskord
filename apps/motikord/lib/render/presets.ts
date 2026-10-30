import type { Feel, Layer, Motion, PresetSlot } from '../types';
import { clamp01, ease } from './easing';

/** How a layer is offset from its resting state. dx/dy are fractions of the canvas short side, blur is px at 1080, glow is 0..1 of the layer-colour shadow. */
export interface Pose { alpha: number; dx: number; dy: number; scale: number; rotate: number; blur: number; reveal: number; typed: number; glow: number }
export const REST: Pose = { alpha: 1, dx: 0, dy: 0, scale: 1, rotate: 0, blur: 0, reveal: 1, typed: 1, glow: 0 };

export interface Preset {
  id: string; slot: PresetSlot; label: string; feels: readonly Feel[]; defaultMs: number;
  /** p is eased progress: 0 is hidden and 1 is at rest for in and out; for during it is the eased phase of one cycle. */
  pose: (p: number) => Partial<Pose>;
}

const ALL: readonly Feel[] = ['smooth', 'snappy', 'bouncy', 'steady'];
const LIFT = 0.08;
const TRAVEL = 0.25;
// Every period-based preset is zero at phase 0 and 1, so the cycle seam never jumps.
const TAU = Math.PI * 2;
const sin2 = (p: number) => Math.sin(Math.PI * p) ** 2;

// Labels are the Presets frame tiles ("Comes in" tab); "Bounce" is from EditorPrompt; "Goes out" reuses the framed verbs.
export const PRESETS = [
  { id: 'fade-in', slot: 'in', label: 'Fade', feels: ALL, defaultMs: 600, pose: (p) => ({ alpha: p }) },
  { id: 'rise-in', slot: 'in', label: 'Rise', feels: ALL, defaultMs: 600, pose: (p) => ({ alpha: clamp01(p * 1.5), dy: (1 - p) * LIFT }) },
  { id: 'pop-in', slot: 'in', label: 'Pop', feels: ALL, defaultMs: 500, pose: (p) => ({ alpha: clamp01(p * 2), scale: Math.max(0, p) }) },
  { id: 'slide-in', slot: 'in', label: 'Slide', feels: ALL, defaultMs: 600, pose: (p) => ({ alpha: clamp01(p * 1.5), dx: -(1 - p) * TRAVEL }) },
  { id: 'wipe-in', slot: 'in', label: 'Wipe', feels: ALL, defaultMs: 600, pose: (p) => ({ reveal: clamp01(p) }) },
  { id: 'type-on', slot: 'in', label: 'Type on', feels: ['steady', 'smooth', 'snappy'], defaultMs: 1200, pose: (p) => ({ typed: clamp01(p) }) },
  { id: 'grow-in', slot: 'in', label: 'Grow', feels: ALL, defaultMs: 600, pose: (p) => ({ alpha: clamp01(p * 1.5), scale: 0.6 + 0.4 * p }) },
  { id: 'blur-in', slot: 'in', label: 'Blur in', feels: ALL, defaultMs: 700, pose: (p) => ({ alpha: clamp01(p), blur: Math.max(0, 1 - p) * 24 }) },
  { id: 'drop-in', slot: 'in', label: 'Drop', feels: ALL, defaultMs: 600, pose: (p) => ({ alpha: clamp01(p * 1.5), dy: -(1 - p) * LIFT }) },
  { id: 'bounce', slot: 'during', label: 'Bounce', feels: ALL, defaultMs: 800, pose: (p) => ({ dy: -Math.sin(Math.PI * clamp01(p)) * 0.03 }) },
  { id: 'pulse', slot: 'during', label: 'Pulse', feels: ALL, defaultMs: 1000, pose: (p) => ({ scale: 1 + 0.08 * sin2(p) }) },
  { id: 'float', slot: 'during', label: 'Float', feels: ALL, defaultMs: 2000, pose: (p) => ({ dy: -0.02 * Math.sin(TAU * p) }) },
  { id: 'shake', slot: 'during', label: 'Shake', feels: ALL, defaultMs: 600, pose: (p) => ({ dx: 0.012 * Math.sin(TAU * 4 * p) }) },
  { id: 'slow-zoom', slot: 'during', label: 'Slow zoom', feels: ALL, defaultMs: 2000, pose: (p) => ({ scale: 1 + 0.08 * Math.sin(Math.PI * p) }) },
  { id: 'glow', slot: 'during', label: 'Glow', feels: ALL, defaultMs: 1200, pose: (p) => ({ glow: sin2(p) }) },
  { id: 'fade-out', slot: 'out', label: 'Fade', feels: ALL, defaultMs: 400, pose: (p) => ({ alpha: clamp01(p) }) },
  { id: 'rise-out', slot: 'out', label: 'Rise', feels: ALL, defaultMs: 500, pose: (p) => ({ alpha: clamp01(p * 1.5), dy: -(1 - p) * LIFT }) },
  { id: 'pop-out', slot: 'out', label: 'Pop', feels: ALL, defaultMs: 400, pose: (p) => ({ alpha: clamp01(p * 2), scale: Math.max(0, p) }) },
  { id: 'slide-out', slot: 'out', label: 'Slide', feels: ALL, defaultMs: 500, pose: (p) => ({ alpha: clamp01(p * 1.5), dx: (1 - p) * TRAVEL }) },
  { id: 'wipe-out', slot: 'out', label: 'Wipe', feels: ALL, defaultMs: 500, pose: (p) => ({ reveal: clamp01(p) }) },
  { id: 'drop-out', slot: 'out', label: 'Drop', feels: ALL, defaultMs: 500, pose: (p) => ({ alpha: clamp01(p * 1.5), dy: (1 - p) * LIFT }) },
] as const satisfies readonly Preset[];

export type PresetId = (typeof PRESETS)[number]['id'];
export const PRESET_IDS: readonly PresetId[] = PRESETS.map((p) => p.id);

const byId = new Map<string, Preset>(PRESETS.map((p) => [p.id, p]));
export const getPreset = (id: string): Preset | undefined => byId.get(id);
export const isPresetId = (id: string): id is PresetId => byId.has(id);
export const presetsFor = (slot: PresetSlot): Preset[] => PRESETS.filter((p) => p.slot === slot);

function apply(pose: Pose, part: Partial<Pose>): Pose {
  return {
    alpha: pose.alpha * (part.alpha ?? 1),
    dx: pose.dx + (part.dx ?? 0),
    dy: pose.dy + (part.dy ?? 0),
    scale: pose.scale * (part.scale ?? 1),
    rotate: pose.rotate + (part.rotate ?? 0),
    blur: pose.blur + (part.blur ?? 0),
    reveal: Math.min(pose.reveal, part.reveal ?? 1),
    typed: Math.min(pose.typed, part.typed ?? 1),
    glow: Math.min(1, pose.glow + (part.glow ?? 0)),
  };
}

// Looping motion eases in and out over this long at both ends of the layer, so it joins the in and out phases without a jump.
const LOOP_RAMP_MS = 250;
// Amplitude per Feel for looping motion; the Feel's curve also warps the cycle rate.
const LOOP_AMP: Record<Feel, number> = { smooth: 1, snappy: 0.9, bouncy: 1.3, steady: 0.8 };

function slotPose(motion: Motion | undefined, slot: PresetSlot, raw: number, pose: Pose, env = 1): Pose {
  const preset = motion && getPreset(motion.preset);
  if (!preset || preset.slot !== slot) return pose;
  const part = preset.pose(ease(motion.feel, raw));
  if (slot !== 'during') return apply(pose, part);
  const k = env * LOOP_AMP[motion.feel];
  return apply(pose, {
    dx: (part.dx ?? 0) * k, dy: (part.dy ?? 0) * k, rotate: (part.rotate ?? 0) * k, blur: (part.blur ?? 0) * k,
    scale: 1 + ((part.scale ?? 1) - 1) * k, glow: clamp01((part.glow ?? 0) * k),
  });
}

/** The pose of a layer `t` ms after the layer starts; `sceneMs` is the scene-local end. Pure, so preview and export agree. */
export function layerPose(layer: Pick<Layer, 'startMs' | 'endMs' | 'in' | 'during' | 'out'>, t: number, sceneMs = Infinity): Pose {
  // A layer that runs past its scene ends with the scene, so its out phase still plays.
  const length = Math.min(layer.endMs, sceneMs) - layer.startMs;
  let pose = REST;
  // In and out that together exceed the layer shrink in proportion so it still reaches full pose.
  const inMs = layer.in ? Math.max(1, layer.in.durationMs) : 0;
  const outMs = layer.out ? Math.max(1, layer.out.durationMs) : 0;
  const k = inMs + outMs > length && length > 0 ? length / (inMs + outMs) : 1;
  if (layer.in) pose = slotPose(layer.in, 'in', t / Math.max(1, inMs * k), pose);
  if (layer.during) {
    const cycle = Math.max(1, layer.during.durationMs);
    const ramp = Math.min(LOOP_RAMP_MS, length / 2);
    const env = ramp > 0 ? clamp01(t / ramp) * clamp01((length - t) / ramp) : 0;
    pose = slotPose(layer.during, 'during', (((t % cycle) + cycle) % cycle) / cycle, pose, env);
  }
  if (layer.out) pose = slotPose(layer.out, 'out', (length - t) / Math.max(1, outMs * k), pose);
  return pose;
}
