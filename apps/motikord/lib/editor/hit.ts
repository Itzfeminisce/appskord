import type { Box, Layer } from '../types';

// Pure geometry for the editor canvas. Points are CSS px on a canvas W x H; boxes are fractions of it.
export interface Pt { x: number; y: number }
export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'rotate' | 'move';

const rad = (deg: number) => (deg * Math.PI) / 180;
const round = (v: number) => Math.round(v * 10000) / 10000;

export function centre(b: Box, W: number, H: number): Pt {
  return { x: (b.x + b.w / 2) * W, y: (b.y + b.h / 2) * H };
}

/** The point in the box's own frame: origin at its centre, axes turned with it. */
export function toLocal(b: Box, p: Pt, W: number, H: number): Pt {
  const c = centre(b, W, H);
  const a = -rad(b.rotation ?? 0);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

export function pointInBox(b: Box, p: Pt, W: number, H: number, pad = 0): boolean {
  const l = toLocal(b, p, W, H);
  return Math.abs(l.x) <= (b.w * W) / 2 + pad && Math.abs(l.y) <= (b.h * H) / 2 + pad;
}

/** The topmost unlocked layer under p; layers are bottom first, as drawn. */
export function hitLayer<L extends Pick<Layer, 'id' | 'locked'>>(layers: readonly L[], boxOf: (l: L) => Box, p: Pt, W: number, H: number): L | undefined {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (!l.locked && pointInBox(boxOf(l), p, W, H)) return l;
  }
  return undefined;
}

/** Where the round Rotate handle sits above the top edge, in the box's own frame (CSS px). */
export const ROTATE_KNOB = { above: 25, radius: 10 };

/** Which handle of a selected box is under p: a corner, the Rotate knob or the ring just outside a corner, the body, or none. */
export function handleAt(b: Box, p: Pt, W: number, H: number, grab = 8, ring = 22): Handle | null {
  const l = toLocal(b, p, W, H);
  const hw = (b.w * W) / 2;
  const hh = (b.h * H) / 2;
  if (Math.hypot(l.x, l.y + hh + ROTATE_KNOB.above) <= ROTATE_KNOB.radius) return 'rotate';
  const corners: [Handle, number, number][] = [['nw', -hw, -hh], ['ne', hw, -hh], ['sw', -hw, hh], ['se', hw, hh]];
  for (const [h, cx, cy] of corners) if (Math.abs(l.x - cx) <= grab && Math.abs(l.y - cy) <= grab) return h;
  if (Math.abs(l.x) <= hw && Math.abs(l.y) <= hh) return 'move';
  for (const [, cx, cy] of corners) if (Math.hypot(l.x - cx, l.y - cy) <= ring) return 'rotate';
  return null;
}

export interface DragOptions { keepRatio?: boolean; snap?: boolean; minPx?: number }

/** The box after dragging `handle` from `from` to `to`. Corners resize with the opposite corner held still. */
export function dragBox(start: Box, handle: Handle, from: Pt, to: Pt, W: number, H: number, opts: DragOptions = {}): Box {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (handle === 'move') return tidy({ ...start, x: start.x + dx / W, y: start.y + dy / H });
  const c = centre(start, W, H);
  const turn = start.rotation ?? 0;
  if (handle === 'rotate') {
    const deg = ((Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(from.y - c.y, from.x - c.x)) * 180) / Math.PI;
    let r = turn + deg;
    if (opts.snap) r = Math.round(r / 15) * 15;
    r = ((((r + 180) % 360) + 360) % 360) - 180;
    return tidy({ ...start, rotation: r === -180 ? 180 : r });
  }
  const a = rad(turn);
  const lx = dx * Math.cos(-a) - dy * Math.sin(-a);
  const ly = dx * Math.sin(-a) + dy * Math.cos(-a);
  const sx = handle === 'ne' || handle === 'se' ? 1 : -1;
  const sy = handle === 'sw' || handle === 'se' ? 1 : -1;
  const min = opts.minPx ?? 8;
  const w0 = start.w * W;
  const h0 = start.h * H;
  // A side already thinner than the minimum (a rule, a line) may keep its size; it just cannot shrink further.
  const minW = Math.min(min, w0);
  const minH = Math.min(min, h0);
  let w = Math.max(minW, w0 + sx * lx);
  let h = Math.max(minH, h0 + sy * ly);
  if (opts.keepRatio && w0 > 0 && h0 > 0) {
    const k = Math.max(w / w0, h / h0);
    w = Math.max(minW, w0 * k);
    h = Math.max(minH, h0 * k);
  }
  // The centre moves half the growth, turned back into canvas axes.
  const gx = (sx * (w - w0)) / 2;
  const gy = (sy * (h - h0)) / 2;
  const cx = c.x + gx * Math.cos(a) - gy * Math.sin(a);
  const cy = c.y + gx * Math.sin(a) + gy * Math.cos(a);
  return tidy({ ...start, x: (cx - w / 2) / W, y: (cy - h / 2) / H, w: w / W, h: h / H });
}

function tidy(b: Box): Box {
  const out: Box = { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
  if (b.rotation !== undefined) out.rotation = round(b.rotation);
  return out;
}

export const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && (a.rotation ?? 0) === (b.rotation ?? 0);
