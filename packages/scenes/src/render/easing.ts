import type { Feel } from '../types';

export type Curve = (t: number) => number;

export const clamp01 = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

const smooth: Curve = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const snappy: Curve = (t) => 1 - (1 - t) ** 5;
// Overshoots past 1 and settles, so it is the only curve that is not monotonic.
const bouncy: Curve = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const steady: Curve = (t) => t;

export const CURVES: Record<Feel, Curve> = { smooth, snappy, bouncy, steady };

/** Eased progress for a Feel; t is clamped to 0..1 so callers can pass raw ratios. */
export function ease(feel: Feel, t: number): number {
  const c = clamp01(t);
  if (c === 0) return 0;
  if (c === 1) return 1;
  return CURVES[feel](c);
}
