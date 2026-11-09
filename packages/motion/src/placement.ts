// Where layers without a layout box rest, and how far the camera may move before text leaves the safe area.
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

/** A camera pose moved `k` (0..1) of the way from rest: pan, zoom and orbit shrink; focus is kept. */
export function limitPose(pose: CameraPose, k: number): CameraPose {
  return { ...pose, x: pose.x * k, y: pose.y * k, zoom: 1 + (pose.zoom - 1) * k, yaw: pose.yaw * k };
}

/** How far `rect` at its depth pokes outside `safe` under `pose`, recipe px; 0 when inside. */
function overflow(rect: Rect, depth: Depth, pose: CameraPose, safe: Rect): number {
  const d = depthPose(depth, pose);
  const x0 = rect.x * d.scale + d.x;
  const y0 = rect.y * d.scale + d.y;
  const x1 = (rect.x + rect.width) * d.scale + d.x;
  const y1 = (rect.y + rect.height) * d.scale + d.y;
  return Math.max(0, safe.x - x0, x1 - (safe.x + safe.width), safe.y - y0, y1 - (safe.y + safe.height));
}

/**
 * The share (0..1) of the scene's camera move that keeps every text block inside `safe` at each pose in `poses`
 * (the move's ends): a block already outside at rest only may not be pushed further out.
 */
export function cameraLimit(
  blocks: readonly { rect: Rect; depth: Depth }[],
  poses: readonly CameraPose[],
  safe: Rect,
): number {
  if (!blocks.length || !Number.isFinite(safe.width)) return 1;
  const worst = (k: number) =>
    Math.max(
      0,
      ...blocks.flatMap((b) => {
        const rest = overflow(b.rect, b.depth, limitPose(poses[0]!, 0), safe);
        return poses.map((p) => overflow(b.rect, b.depth, limitPose(p, k), safe) - rest);
      }),
    );
  if (worst(1) <= 0.5) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (worst(mid) <= 0.5) lo = mid;
    else hi = mid;
  }
  return lo;
}
