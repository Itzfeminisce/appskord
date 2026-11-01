import type { Feel } from '../project/types';

/** How long each feel takes to settle from a standing start (to within 0.1 %). */
export const SETTLE_MS: Record<Feel, number> = { calm: 900, smooth: 600, snappy: 300 };
/** Fastest a zoom may change its scale, as d(ln scale)/dt per second. */
export const MAX_ZOOM_RATE = 8;

// ω·t at which a critically damped spring from rest is within 0.1 % of its target: (1 + k)e^-k = 0.001.
const K = 9.2335;
const raw = (k: number) => 1 - (1 + k) * Math.exp(-k);
const END = raw(K);
/** Steepest slope of `ease`, at progress 1 / K. */
export const PEAK_SLOPE = K / Math.E / END;

/** Spring easing 0..1 → 0..1: a critically damped spring from rest, scaled to land exactly at 1. */
export function ease(progress: number): number {
  if (!(progress > 0)) return 0;
  if (progress >= 1) return 1;
  return raw(K * progress) / END;
}

/** Spring stiffness ω (per ms) that settles in `settleMs`. */
export const omega = (settleMs: number) => K / Math.max(1, settleMs);

/** How long a zoom to `depth` takes to go in (and out): the feel's time, longer when it would be too fast. */
export function rampMs(depth: number, feel: Feel): number {
  const ln = Math.log(Math.max(1, depth));
  return Math.max(SETTLE_MS[feel], (ln * PEAK_SLOPE * 1000) / MAX_ZOOM_RATE);
}

export interface SpringState { x: number; v: number }   // v: per ms

/** Exact step of a critically damped spring towards a fixed `target` over `dt` ms. */
export function springStep({ x, v }: SpringState, target: number, dt: number, w: number): SpringState {
  if (dt <= 0) return { x, v };
  const u = x - target;
  const c = v + w * u;
  const decay = Math.exp(-w * dt);
  return { x: target + (u + c * dt) * decay, v: (v - w * c * dt) * decay };
}
