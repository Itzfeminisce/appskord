// Where layers without a layout box rest, and the part of the safe area text keeps clear of the camera's travel.
// Pure: rectangles in recipe px around the frame's centre, y down.
import type { CameraPose } from './camera';
import { depthPose } from './depth';
import type { Rect } from './type';
import type { Depth } from './types';

/** Recipe px kept clear around a text box when a layer the template adds is placed. */
export const CLEAR = 24;
/** Sizes a layer the template adds tries, largest first, before it settles for the spot it overlaps text least. */
export const SPOT_SCALES = [1, 0.75, 0.5, 0.35] as const;
const STEPS = 12;

const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const grow = (r: Rect, d: number): Rect => ({
  x: r.x - d,
  y: r.y - d,
  width: r.width + 2 * d,
  height: r.height + 2 * d,
});

/** Centres along one side of `span` where a block `s` wide fits; its middle when it is too big. */
function stops(lo: number, span: number, s: number): number[] {
  if (s >= span) return [lo + span / 2];
  const from = lo + s / 2;
  const travel = span - s;
  return Array.from({ length: STEPS + 1 }, (_, i) => from + (travel * i) / STEPS);
}

/**
 * Where a block `size` rests inside `area` so it covers the text boxes `taken` least: the largest of SPOT_SCALES
 * that clears them by CLEAR, else the smallest at its least overlap; ties go to the spot nearest the centre.
 */
export function freeSpot(
  size: { width: number; height: number },
  taken: readonly Rect[],
  area: Rect,
  scales: readonly number[] = SPOT_SCALES,
): { x: number; y: number; scale: number } {
  if (!Number.isFinite(area.width) || !Number.isFinite(area.height)) return { x: 0, y: 0, scale: 1 };
  const clear = taken.map((r) => grow(r, CLEAR));
  let best = { x: 0, y: 0, scale: 1, cost: Infinity, far: Infinity };
  for (const scale of scales) {
    const w = size.width * scale;
    const h = size.height * scale;
    for (const x of stops(area.x, area.width, w))
      for (const y of stops(area.y, area.height, h)) {
        const block = { x: x - w / 2, y: y - h / 2, width: w, height: h };
        const cost = clear.reduce((sum, r) => sum + overlap(block, r), 0);
        const far = Math.hypot(x, y);
        if (cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && far < best.far))
          best = { x, y, scale, cost, far };
      }
    if (best.cost <= 1e-9) break;
  }
  return { x: best.x, y: best.y, scale: best.scale };
}

/** The box round every rect in `rects`; undefined when there are none. */
export function union(rects: readonly Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The smallest share of the safe area's width and height text keeps however far the camera travels. */
export const MIN_INSET_SHARE = 0.5;

/**
 * The part of `safe` that text at `depth` rests in so the camera's whole move (its poses at each end) keeps it
 * inside `safe`: shrunk by how far the move carries that depth, never below MIN_INSET_SHARE of each side.
 */
export function travelSafe(safe: Rect, poses: readonly CameraPose[], depth: Depth): Rect {
  if (!Number.isFinite(safe.width) || !Number.isFinite(safe.height)) return safe;
  let [x0, y0, x1, y1] = [safe.x, safe.y, safe.x + safe.width, safe.y + safe.height];
  for (const pose of poses) {
    const d = depthPose(depth, pose);
    // A point p shows at p * scale + offset: keep both edges inside safe.
    x0 = Math.max(x0, (safe.x - d.x) / d.scale);
    x1 = Math.min(x1, (safe.x + safe.width - d.x) / d.scale);
    y0 = Math.max(y0, (safe.y - d.y) / d.scale);
    y1 = Math.min(y1, (safe.y + safe.height - d.y) / d.scale);
  }
  const side = (lo: number, hi: number, slo: number, span: number): [number, number] => {
    const min = span * MIN_INSET_SHARE;
    if (hi - lo >= min) return [lo, hi];
    const mid = Math.min(Math.max((lo + hi) / 2, slo + min / 2), slo + span - min / 2);
    return [mid - min / 2, mid + min / 2];
  };
  const [ax, bx] = side(x0, x1, safe.x, safe.width);
  const [ay, by] = side(y0, y1, safe.y, safe.height);
  return { x: ax, y: ay, width: bx - ax, height: by - ay };
}

/** `slot` carried from `safe` into `inner` by the same stretch, so a layout shrunk into `inner` keeps its shape. */
export function mapSlot(slot: Rect, safe: Rect, inner: Rect): Rect {
  if (!Number.isFinite(safe.width) || !Number.isFinite(safe.height) || safe.width <= 0 || safe.height <= 0) return slot;
  const kx = inner.width / safe.width;
  const ky = inner.height / safe.height;
  return {
    x: inner.x + (slot.x - safe.x) * kx,
    y: inner.y + (slot.y - safe.y) * ky,
    width: slot.width * kx,
    height: slot.height * ky,
  };
}
