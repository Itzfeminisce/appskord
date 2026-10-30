import type { Aspect, Box, Layer, Quality } from '../types';

/** The layout ids a scene may use; the only set AI may pick. */
export const LAYOUTS = ['center', 'top', 'bottom', 'lower-third', 'split', 'full'] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export const isLayoutId = (id: string): id is LayoutId => (LAYOUTS as readonly string[]).includes(id);

export interface Insets { top: number; right: number; bottom: number; left: number }
// 9:16 keeps clear of the app bars and caption area that phone players draw over the clip.
export const SAFE: Record<Aspect, Insets> = {
  '9:16': { top: 0.12, right: 0.06, bottom: 0.2, left: 0.06 },
  '1:1': { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
  '16:9': { top: 0.05, right: 0.05, bottom: 0.05, left: 0.05 },
};

const RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };
const EPS = 1e-3;

/** Canvas size in short-side units, so 1 unit is the same on every size. */
function units(aspect: Aspect): { W: number; H: number } {
  const r = RATIO[aspect];
  return r >= 1 ? { W: r, H: 1 } : { W: 1, H: 1 / r };
}

/** Pixel size of a canvas whose short side is `short` px (720 or 1080). */
export function canvasSize(aspect: Aspect, short: number): { w: number; h: number } {
  const { W, H } = units(aspect);
  return { w: Math.round(W * short), h: Math.round(H * short) };
}
export const qualityShort = (q: Quality) => (q === '720p' ? 720 : 1080);

export function safeBox(aspect: Aspect): Box {
  const s = SAFE[aspect];
  return { x: s.left, y: s.top, w: 1 - s.left - s.right, h: 1 - s.top - s.bottom };
}

/** A background-sized box; it is meant to cover the canvas, so reflow and the safe area leave it alone. */
export const isFullBleed = (b: Box) => b.w >= 0.95 && b.h >= 0.95;

export function insideSafe(b: Box, aspect: Aspect): boolean {
  const s = safeBox(aspect);
  return b.x >= s.x - EPS && b.y >= s.y - EPS && b.x + b.w <= s.x + s.w + EPS && b.y + b.h <= s.y + s.h + EPS;
}

/** Shrinks (keeping shape on screen) and then shifts a box until it sits inside the safe area. */
export function clampToSafe(b: Box, aspect: Aspect): Box {
  const s = safeBox(aspect);
  const k = Math.min(1, s.w / Math.max(b.w, EPS), s.h / Math.max(b.h, EPS));
  const w = b.w * k;
  const h = b.h * k;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const x = Math.min(Math.max(cx - w / 2, s.x), s.x + s.w - w);
  const y = Math.min(Math.max(cy - h / 2, s.y), s.y + s.h - h);
  return withRotation({ x: round(x), y: round(y), w: round(w), h: round(h) }, b);
}

export interface ReflowOptions { layout?: string; keepShape?: boolean }

const wide = (a: Aspect) => RATIO[a] > 1;
const tall = (a: Aspect) => RATIO[a] < 1;

/** Turns a box drawn for one size into one for another: same place in the safe area, same arrangement, inside safe areas. */
export function reflowBox(b: Box, from: Aspect, to: Aspect, opts: ReflowOptions = {}): Box {
  if (from === to) return { ...b };
  if (isFullBleed(b)) return { ...b };
  let { x, y, w, h } = b;
  // A split layout stacks its halves when a wide size becomes a tall one, and sets them side by side the other way.
  if (opts.layout === 'split' && wide(from) && tall(to)) {
    const half = x + w / 2 < 0.5 ? 0 : 1;
    [x, w, y, h] = [(x - half * 0.5) * 2, w * 2, y * 0.5 + half * 0.5, h * 0.5];
  } else if (opts.layout === 'split' && tall(from) && wide(to)) {
    const half = y + h / 2 < 0.5 ? 0 : 1;
    [x, w, y, h] = [x * 0.5 + half * 0.5, w * 0.5, (y - half * 0.5) * 2, h * 2];
  }
  // Fractions map from one safe area to the other, so boxes that did not overlap still do not.
  const f = safeBox(from);
  const t = safeBox(to);
  let nw = (w / f.w) * t.w;
  let nh = (h / f.h) * t.h;
  const cx = t.x + ((x + w / 2 - f.x) / f.w) * t.w;
  const cy = t.y + ((y + h / 2 - f.y) / f.h) * t.h;
  if (opts.keepShape) {
    // Pictures, charts and circles keep their on-screen shape inside the stretched box.
    const a = units(from);
    const z = units(to);
    const want = (b.w * a.W) / Math.max(b.h * a.H, EPS);
    const have = (nw * z.W) / Math.max(nh * z.H, EPS);
    if (have > want) nw *= want / have;
    else nh *= have / want;
  }
  return clampToSafe(withRotation({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }, b), to);
}

/** Layers whose on-screen shape matters; text, cards and rules may stretch with the canvas. */
const keepsShape = (l: Pick<Layer, 'type'> & { shape?: string }) => l.type === 'image' || l.type === 'video' || l.type === 'chart' || l.shape === 'circle';

/** The box a layer uses on `aspect`: its "This size only" override, else its main box reflowed from the edited size. */
export function boxFor(layer: Pick<Layer, 'box' | 'boxes' | 'type'> & { shape?: string }, aspect: Aspect, source: Aspect, layout?: string): Box {
  const own = layer.boxes?.[aspect];
  if (own) return own;
  if (aspect === source) return layer.box;
  return reflowBox(layer.box, source, aspect, { layout, keepShape: keepsShape(layer) });
}

const round = (v: number) => Math.round(v * 10000) / 10000;
const withRotation = (b: Box, src: Box): Box => (src.rotation === undefined ? b : { ...b, rotation: src.rotation });
