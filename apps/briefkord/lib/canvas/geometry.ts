import type { Rect } from '../board/types';

/** Screen point = world point * zoom + (x, y). */
export interface Camera { x: number; y: number; zoom: number }
export interface Size { w: number; h: number }
export interface Point { x: number; y: number }

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The part of the world a screen of `size` shows, in canvas units. */
export function worldRect(camera: Camera, size: Size): Rect {
  return { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: size.w / camera.zoom, h: size.h / camera.zoom };
}

/** Zooms by `factor`, keeping the world point under `at` (screen) still. */
export function zoomAt(camera: Camera, at: Point, factor: number, min = ZOOM_MIN, max = ZOOM_MAX): Camera {
  const zoom = clamp(camera.zoom * factor, min, max);
  const wx = (at.x - camera.x) / camera.zoom;
  const wy = (at.y - camera.y) / camera.zoom;
  return { x: at.x - wx * zoom, y: at.y - wy * zoom, zoom };
}

/** Camera that fits `bounds` into `size` with `pad` screen pixels around it. */
export function fitCamera(bounds: Rect, size: Size, pad = 40, min = ZOOM_MIN, max = 1): Camera {
  const zoom = clamp(Math.min((size.w - 2 * pad) / Math.max(bounds.w, 1), (size.h - 2 * pad) / Math.max(bounds.h, 1)), min, max);
  return { x: (size.w - bounds.w * zoom) / 2 - bounds.x * zoom, y: (size.h - bounds.h * zoom) / 2 - bounds.y * zoom, zoom };
}

export function boundsOf(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Ids of the cards that touch `viewport` (canvas units) grown by `margin` screen pixels,
 * so cards about to scroll in already have their content.
 */
export function visibleCards(cards: readonly { id: string; rect: Rect }[], viewport: Rect, zoom: number, margin = 0): Set<string> {
  const m = margin / zoom;
  const left = viewport.x - m, top = viewport.y - m;
  const right = viewport.x + viewport.w + m, bottom = viewport.y + viewport.h + m;
  const ids = new Set<string>();
  for (const { id, rect } of cards) {
    if (rect.x < right && rect.x + rect.w > left && rect.y < bottom && rect.y + rect.h > top) ids.add(id);
  }
  return ids;
}

function edgePoint(from: Rect, toward: Point): Point {
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(dx === 0 ? Infinity : from.w / 2 / Math.abs(dx), dy === 0 ? Infinity : from.h / 2 / Math.abs(dy));
  return { x: cx + dx * t, y: cy + dy * t };
}

/** Arrow from the edge of `a` to the edge of `b`, along the line between their centres. */
export function arrowLine(a: Rect, b: Rect): { from: Point; to: Point } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  return { from: edgePoint(a, cb), to: edgePoint(b, ca) };
}
