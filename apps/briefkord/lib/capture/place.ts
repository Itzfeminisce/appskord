/** Where a captured card lands on the canvas: the first free spot, reading left to right and top to bottom. */
import type { Rect } from '../board/types';

export const PLACE_GAP = 24;
export const PLACE_GRID = 20;
/** Where the first card of an empty board goes. */
export const PLACE_ORIGIN = { x: 80, y: 80 };

const overlaps = (a: Rect, b: Rect, gap: number): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** The top-left corner for a card of `size` that keeps `gap` clear of every rect, on a `grid` within or just right of the cards. */
export function freeSpot(rects: readonly Rect[], size: { w: number; h: number }, gap = PLACE_GAP, grid = PLACE_GRID): { x: number; y: number } {
  const placed = rects.filter((r) => [r.x, r.y, r.w, r.h].every(Number.isFinite));
  if (!placed.length) return { ...PLACE_ORIGIN };
  const snap = (v: number) => Math.round(v / grid) * grid;
  const left = snap(Math.min(...placed.map((r) => r.x)));
  const top = snap(Math.min(...placed.map((r) => r.y)));
  const right = Math.max(...placed.map((r) => r.x + r.w));
  const bottom = Math.max(...placed.map((r) => r.y + r.h));
  const fits = (x: number, y: number) => !placed.some((r) => overlaps({ x, y, ...size }, r, gap));
  // A coarser step on huge boards keeps the scan to about 20,000 tries.
  const step = Math.max(grid, Math.ceil(Math.sqrt(((right - left) * (bottom - top)) / 20_000) / grid) * grid);
  for (let y = top; y <= bottom; y += step) {
    for (let x = left; x <= right + gap; x += step) if (fits(x, y)) return { x, y };
  }
  return { x: snap(right + gap + grid / 2), y: top };
}
