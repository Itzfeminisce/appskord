import { interpolate } from 'flubber';
import type { Point } from './paths';
import type { ShapeMesh } from './shapes';

/** Morph outlines are resampled to segments no longer than this, in recipe units (1080-wide frame). */
export const MORPH_SEGMENT = 6;

/**
 * One shape flowing into the next, by morph progress 0..1 (the layer's `morph` track).
 * Ends are the exact input outlines; springs that overshoot hold at the ends.
 */
export function morpher(
  from: readonly Point[],
  to: readonly Point[],
  maxSegmentLength = MORPH_SEGMENT,
): (t: number) => Point[] {
  const a = from.map((p) => [p[0], p[1]]);
  const b = to.map((p) => [p[0], p[1]]);
  const mid = interpolate(a, b, { maxSegmentLength, string: false }) as unknown as (t: number) => number[][];
  return (t) => {
    if (!(t > 0)) return from.map((p) => [p[0], p[1]]);
    if (t >= 1) return to.map((p) => [p[0], p[1]]);
    return mid(t).map((p) => [p[0] as number, p[1] as number]);
  };
}

/** Morphs a ShapeMesh along the layer's `morph` track, reading the state applyFrame left in userData. */
export class Morph {
  private readonly at: (t: number) => Point[];
  private last = Number.NaN;

  constructor(
    readonly mesh: ShapeMesh,
    from: readonly Point[],
    to: readonly Point[],
  ) {
    this.at = morpher(from, to);
  }

  update(userData: { morph?: number; opacity?: number }): void {
    const t = Math.min(1, Math.max(0, userData.morph ?? 0));
    if (t !== this.last) this.mesh.setPoints(this.at(t));
    this.last = t;
    this.mesh.material.opacity = userData.opacity ?? 1;
  }
}
