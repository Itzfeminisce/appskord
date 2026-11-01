import type { Aspect, Box } from '../types';

/** A convex polygon in 0..1 frame fractions. */
export type Poly = [number, number][];
/** Moves boxes along one axis from one range into another, so text keeps to the field beside a block. */
export interface Squeeze { axis: 'x' | 'y'; from: [number, number]; to: [number, number] }
export interface BlockPlan { shape: Poly; squeeze?: Squeeze }

const GAP = 0.03;          // field left between text and a block
const MIN_BAND = 0.1;      // thinner than this, a preferred band gives way to a squeeze
const MIN_STRIP = 0.04;    // the thinnest edge strip worth drawing
const MAX_SQUEEZE = 0.55;  // text keeps at least this share of its span

type Side = 'top' | 'bottom' | 'left' | 'right';
// StylePacks/FormatsV2 Bold: 9:16 a slanted lower band, 1:1 a right panel, 16:9 a left side band.
const PREFERRED: Record<Aspect, { side: Side; size: number }> = {
  '9:16': { side: 'bottom', size: 0.3 },
  '1:1': { side: 'right', size: 0.35 },
  '16:9': { side: 'left', size: 0.3 },
};

function band(side: Side, size: number, slant: boolean): Poly {
  if (side === 'bottom') {
    // Rises to the right; the left edge sits lower by a quarter of the band.
    const top = 1 - size;
    const s = slant ? size * 0.23 : 0;
    return [[0, Math.min(1, top + s)], [1, top], [1, 1], [0, 1]];
  }
  if (side === 'top') return [[0, 0], [1, 0], [1, size], [0, size]];
  if (side === 'left') return [[0, 0], [size, 0], [size, 1], [0, 1]];
  return [[1 - size, 0], [1, 0], [1, 1], [1 - size, 1]];
}

/** Free depth between the boxes and one edge of the frame. */
function margin(side: Side, boxes: Box[]): number {
  if (!boxes.length) return 1;
  if (side === 'top') return Math.min(...boxes.map((b) => b.y));
  if (side === 'bottom') return 1 - Math.max(...boxes.map((b) => b.y + b.h));
  if (side === 'left') return Math.min(...boxes.map((b) => b.x));
  return 1 - Math.max(...boxes.map((b) => b.x + b.w));
}

/**
 * Where a "blocks" background puts its slab on one size, given the boxes of everything drawn on the field. Pure.
 * The pack's band when the boxes leave room; else the boxes squeeze beside it; else a strip in the widest free margin;
 * undefined when no edge has room. Text never sits on the slab.
 */
export function planBlocks(boxes: Box[], aspect: Aspect, safe: Box, fits: (q: Squeeze) => boolean = () => true): BlockPlan | undefined {
  const { side, size } = PREFERRED[aspect];
  const slant = side === 'bottom';
  const free = margin(side, boxes) - GAP;
  if (free >= MIN_BAND) return { shape: band(side, Math.min(size, free), slant) };
  const axis = side === 'left' || side === 'right' ? 'x' : 'y';
  const lo = Math.min(...boxes.map((b) => (axis === 'x' ? b.x : b.y)), axis === 'x' ? safe.x : safe.y);
  const hi = Math.max(...boxes.map((b) => (axis === 'x' ? b.x + b.w : b.y + b.h)), axis === 'x' ? safe.x + safe.w : safe.y + safe.h);
  // The widest band whose squeeze still lets every slot's words fit at their size; the slant's highest point is the field's edge.
  for (let sz = size; sz >= MIN_BAND - 1e-9; sz -= 0.05) {
    const to: [number, number] = side === 'left' || side === 'top' ? [Math.max(lo, sz + GAP), hi] : [lo, Math.min(hi, 1 - sz - GAP)];
    const q: Squeeze = { axis, from: [lo, hi], to };
    if ((to[1] - to[0]) / (hi - lo) >= MAX_SQUEEZE && fits(q)) return { shape: band(side, sz, slant), squeeze: q };
  }
  const sides: Side[] = ['bottom', 'right', 'left', 'top'];
  const best = sides.map((s) => ({ s, m: margin(s, boxes) - 0.01 })).sort((a, b) => b.m - a.m)[0]!;
  return best.m >= MIN_STRIP ? { shape: band(best.s, best.m, false) } : undefined;
}

export function squeezeBox(b: Box, q: Squeeze | undefined): Box {
  if (!q) return b;
  const k = (q.to[1] - q.to[0]) / (q.from[1] - q.from[0]);
  const map = (v: number) => q.to[0] + (v - q.from[0]) * k;
  return q.axis === 'x' ? { ...b, x: map(b.x), w: b.w * k } : { ...b, y: map(b.y), h: b.h * k };
}

/** Whether a convex polygon and a box share any area (separating axis test). */
export function polyHitsBox(poly: Poly, b: Box, e = 1e-6): boolean {
  if (poly.length < 3) return false;
  const rect: Poly = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  const axes: [number, number][] = [[1, 0], [0, 1]];
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]!; axes.push([q[1] - p[1], p[0] - q[0]]); });
  for (const [ax, ay] of axes) {
    const proj = (ps: Poly) => ps.map(([x, y]) => x * ax + y * ay);
    const a = proj(poly);
    const r = proj(rect);
    if (Math.max(...a) <= Math.min(...r) + e || Math.max(...r) <= Math.min(...a) + e) return false;
  }
  return true;
}

/** The aspect a canvas of w by h draws. */
export const aspectOf = (w: number, h: number): Aspect => (w / h > 1.3 ? '16:9' : w / h < 0.8 ? '9:16' : '1:1');
