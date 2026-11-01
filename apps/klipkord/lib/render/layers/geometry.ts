import type { Box, RenderPlan } from '../../project/types';

// Box maths shared by both backends. Plan boxes are px in FRAME[shape]; draw boxes are canvas px.

export interface Size { w: number; h: number }
/** Canvas px per frame px on each axis. */
export interface Scale { x: number; y: number }

export const box = (x = 0, y = 0, w = 0, h = 0): Box => ({ x, y, w, h });

/** Frame px → canvas px, written into `out` so a frame allocates nothing. */
export function toCanvas(b: Box, s: Scale, out: Box): Box {
  out.x = b.x * s.x;
  out.y = b.y * s.y;
  out.w = b.w * s.x;
  out.h = b.h * s.y;
  return out;
}

/** Where a 0..1 box of the screen picture lands in the frame, given the crop shown in `dest`. */
export function overlayBox(b: Box, screen: Pick<NonNullable<RenderPlan['screen']>, 'crop' | 'dest'>, out: Box): Box {
  const { crop, dest } = screen;
  out.x = dest.x + ((b.x - crop.x) / crop.w) * dest.w;
  out.y = dest.y + ((b.y - crop.y) / crop.h) * dest.h;
  out.w = (b.w / crop.w) * dest.w;
  out.h = (b.h / crop.h) * dest.h;
  return out;
}

/** The overlap of two boxes, or false when they do not meet. */
export function intersect(a: Box, b: Box, out: Box): boolean {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r <= x || btm <= y) return false;
  out.x = x;
  out.y = y;
  out.w = r - x;
  out.h = btm - y;
  return true;
}

/** The centred 0..1 part of a picture of `src` size that fills `dest` without bars. */
export function coverCrop(src: Size, dest: Size, out: Box): Box {
  const sa = src.w / src.h;
  const da = dest.w / dest.h;
  if (!Number.isFinite(sa) || !Number.isFinite(da) || sa <= 0 || da <= 0) return Object.assign(out, { x: 0, y: 0, w: 1, h: 1 });
  if (sa > da) {
    out.w = da / sa;
    out.h = 1;
  } else {
    out.w = 1;
    out.h = sa / da;
  }
  out.x = (1 - out.w) / 2;
  out.y = (1 - out.h) / 2;
  return out;
}

/** The largest box of `src`'s aspect inside `area`, centred. */
export function containBox(src: Size, area: Box, out: Box): Box {
  const aspect = src.w / src.h;
  const w = Math.min(area.w, area.h * aspect);
  const h = w / aspect;
  out.x = area.x + (area.w - w) / 2;
  out.y = area.y + (area.h - h) / 2;
  out.w = w;
  out.h = h;
  return out;
}

/** A 0..1 crop of a picture → source px. */
export function cropPx(crop: Box, src: Size, out: Box): Box {
  out.x = crop.x * src.w;
  out.y = crop.y * src.h;
  out.w = crop.w * src.w;
  out.h = crop.h * src.h;
  return out;
}

/** Corner radius of the camera: a circle when round, else a soft square. */
export const cameraRadius = (shape: 'round' | 'rounded', dest: Size) => Math.min(dest.w, dest.h) * (shape === 'round' ? 0.5 : 0.16);
/** The white ring around the camera, frame px. */
export const cameraRing = (dest: Size) => Math.min(6, Math.min(dest.w, dest.h) * 0.04);

/** A drop shadow from the look's shadow value (its blur, px at 1080p), like the frames' `0 12px 30px rgba(0,0,0,0.35)`. */
export interface Shadow { sigma: number; dy: number; alpha: number }
export function shadowOf(blur: number, out: Shadow): Shadow {
  out.sigma = Math.max(0, blur) / 2;
  out.dy = Math.max(0, blur) * 0.4;
  out.alpha = blur > 0 ? 0.35 : 0;
  return out;
}

/** CSS `linear-gradient(135deg, …)` line through a box: start and end points. */
export function gradientLine(b: Box): { x0: number; y0: number; x1: number; y1: number } {
  const len = (b.w + b.h) * Math.SQRT1_2;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const d = (len / 2) * Math.SQRT1_2;
  return { x0: cx - d, y0: cy - d, x1: cx + d, y1: cy + d };
}

/** Privacy box strength (0..1) → blur radius and pixel block, frame px. */
export const blurRadius = (amount: number) => 4 + Math.min(1, Math.max(0, amount)) * 28;
export const pixelBlock = (amount: number) => 6 + Math.min(1, Math.max(0, amount)) * 34;
/** Blur of the "Blurred screen" background, frame px. */
export const BACKGROUND_BLUR = 40;
/** Overlays fade or pop in and out over this long. */
export const MOTION_MS = 200;

/** How far an overlay is shown at `rec`: alpha and scale for its motion. */
export function motionAt(motion: 'fade' | 'pop' | 'none', at: number, end: number, rec: number): { alpha: number; scale: number } {
  if (motion === 'none') return { alpha: 1, scale: 1 };
  const k = Math.max(0, Math.min(1, (rec - at) / MOTION_MS, (end - rec) / MOTION_MS));
  return motion === 'pop' ? { alpha: k, scale: 0.85 + 0.15 * k } : { alpha: k, scale: 1 };
}
