import { MARGIN_SHARE } from '../bubble';
import { captionAt, type Caption } from '../project/captions';
import { spanAt, toOut } from '../project/time';
import type {
  Box, Camera, Cut, EventsTrack, Feel, LayoutKind, Look, Project, RecEvent, RenderPlan, Shape, Source,
} from '../project/types';

// Boxes in a RenderPlan: `crop` is 0..1 of the screen picture; `dest`, radius and shadow are px in FRAME[shape].

/** Frame size per shape at 1080p; the renderer scales it to the preview or export size. */
export const FRAME: Record<Shape, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 }, '9:16': { w: 1080, h: 1920 }, '1:1': { w: 1080, h: 1080 }, '4:5': { w: 1080, h: 1350 },
};
/** How long a zoom takes to go in and come out. */
export const ZOOM_MS: Record<Feel, number> = { calm: 900, smooth: 600, snappy: 300 };
/** A "Smooth" layout switch moves the boxes over this long. */
export const SWITCH_MS = 400;
/** A click ring fades over this long. */
export const CLICK_MS = 500;
/** Share of the frame the screen keeps beside the camera in "Side by side". */
export const SIDE_SHARE = 0.68;
/** In "Screen over camera", the screen takes at most this share of the frame height. */
export const STACK_MAX = 0.6;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpBox = (a: Box, b: Box, t: number): Box => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
const FULL: Box = { x: 0, y: 0, w: 1, h: 1 };

/** Easing for zooms and smooth switches, 0..1 → 0..1. Linear until T10's lib/render/spring.ts replaces it. */
export function ease(progress: number, _feel: Feel = 'smooth'): number {
  return clamp01(progress);
}

/** The largest box of this aspect (w / h) inside `area`, centred. */
export function fit(aspect: number, area: Box): Box {
  const w = Math.min(area.w, area.h * aspect);
  const h = w / aspect;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

const aspectOf = (s: Source | undefined, fallback: number) => (s?.width && s.height ? s.width / s.height : fallback);

/** Where the screen and camera sit for one layout. `follow`: the screen fills its box and the crop follows the cursor. */
export interface Arrangement { screen?: Box; camera?: Box; follow: boolean }

export interface ArrangeInput {
  layout: LayoutKind; shape: Shape; fit: Cut['fit']; look: Look; camera: Camera; screenAspect: number; cameraAspect: number;
}

/** All shape and fit maths: 16:9, 9:16 stack / follow / bars, 1:1 and 4:5. */
export function arrange({ layout, shape, fit: vfit, look, camera, screenAspect, cameraAspect }: ArrangeInput): Arrangement {
  const { w: W, h: H } = FRAME[shape];
  const short = Math.min(W, H);
  const p = look.padding;
  const inner: Box = { x: p, y: p, w: Math.max(1, W - 2 * p), h: Math.max(1, H - 2 * p) };
  const tall = shape !== '16:9';
  if (layout === 'camera') return { camera: { x: 0, y: 0, w: W, h: H }, follow: false };

  const follow = tall && vfit === 'follow';
  const screenOnly = (): Box => (follow ? inner : fit(screenAspect, inner));
  // Camera size is a share of the short side, so a tall frame does not get a huge bubble.
  const bubble = (): Box => {
    const gap = Math.round(short * MARGIN_SHARE);
    const d = Math.max(0, Math.min(Math.round(short * camera.size), short - 2 * gap));
    const left = camera.corner.endsWith('left');
    const top = camera.corner.startsWith('top');
    return { x: left ? gap : W - gap - d, y: top ? gap : H - gap - d, w: d, h: d };
  };
  const gap = Math.max(16, p / 2);

  if (layout === 'screen') return { screen: screenOnly(), follow };
  if (tall && (vfit === 'stack' || (layout === 'side' && vfit !== 'follow'))) {
    const screen = fit(screenAspect, { ...inner, h: Math.min(inner.h * STACK_MAX, inner.w / screenAspect) });
    const top = { ...screen, y: inner.y };
    const below = inner.y + top.h + gap;
    return { screen: top, camera: { x: inner.x, y: below, w: inner.w, h: Math.max(0, inner.y + inner.h - below) }, follow: false };
  }
  if (layout === 'side' && !tall) {
    const left: Box = { ...inner, w: inner.w * SIDE_SHARE - gap / 2 };
    const right: Box = { x: left.x + left.w + gap, y: inner.y, w: inner.w - left.w - gap, h: inner.h };
    return { screen: fit(screenAspect, left), camera: fit(Math.min(cameraAspect, 3 / 4), right), follow: false };
  }
  return { screen: screenOnly(), camera: bubble(), follow };
}

// ---- Events ----

type Pointer = Extract<RecEvent, { type: 'move' | 'click' }>;
const isPointer = (e: RecEvent): e is Pointer => e.type === 'move' || e.type === 'click';

/** Index of the last event at or before `t` (events sorted by t), or -1. */
function lastAt(events: RecEvent[], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** Cursor position (0..1 of the viewport) at a recording time, and the click ring (1 at the click, fading to 0). */
export function cursorAt(events: RecEvent[], rec: number, smooth: boolean): { x: number; y: number; click: number } | null {
  const last = lastAt(events, rec);
  let i = last;
  while (i >= 0 && !isPointer(events[i]!)) i--;
  const prev = events[i];
  if (!prev || !isPointer(prev)) return null;
  let { x, y } = prev;
  if (smooth) {
    let n = i + 1;
    while (n < events.length && !isPointer(events[n]!)) n++;
    const next = events[n];
    if (next && isPointer(next) && next.t > prev.t) {
      const k = (rec - prev.t) / (next.t - prev.t);
      x = lerp(prev.x, next.x, k);
      y = lerp(prev.y, next.y, k);
    }
  }
  let click = 0;
  for (let j = last; j >= 0 && rec - events[j]!.t < CLICK_MS; j--) {
    if (events[j]!.type === 'click') { click = 1 - (rec - events[j]!.t) / CLICK_MS; break; }
  }
  return { x, y, click };
}

// ---- Layout over time ----

/** The layout at a recording time, with the one it is leaving while a smooth switch runs. */
export function layoutAt(cut: Cut, rec: number, camera: boolean): { from: LayoutKind; to: LayoutKind; progress: number } {
  const fallback: LayoutKind = camera ? 'bubble' : 'screen';
  if (!camera) return { from: fallback, to: fallback, progress: 1 };
  const list = [...cut.layouts].sort((a, b) => a.at - b.at);
  const i = list.findLastIndex((s) => s.at <= rec);
  const now = list[i];
  if (!now) return { from: fallback, to: fallback, progress: 1 };
  const before = list[i - 1]?.layout ?? fallback;
  const progress = now.switch === 'smooth' ? ease((rec - now.at) / SWITCH_MS) : 1;
  return { from: before, to: now.layout, progress };
}

// ---- The plan ----

/** The crop of the screen picture: a window that follows the cursor in a tall frame, then the zoom. */
function cropFor(cut: Cut, rec: number, dest: Box, screenAspect: number, follow: boolean, cursor: { x: number; y: number } | null): Box {
  let base = FULL;
  const centre = cursor ?? { x: 0.5, y: 0.5 };
  if (follow) {
    // Same shape as the box it fills: (w * screenAspect) / h = dest.w / dest.h.
    const ratio = dest.w / dest.h / screenAspect;
    const w = Math.min(1, ratio);
    const h = Math.min(1, w / ratio);
    base = { x: clamp01(Math.min(1 - w, centre.x - w / 2)), y: clamp01(Math.min(1 - h, centre.y - h / 2)), w, h };
  }
  if (cut.tracks.zooms?.hidden) return base;
  const zoom = [...cut.zooms].reverse().find((z) => rec >= z.at && rec < z.end);
  if (!zoom) return base;
  const ms = ZOOM_MS[zoom.feel];
  const e = Math.min(ease((rec - zoom.at) / ms, zoom.feel), ease((zoom.end - rec) / ms, zoom.feel));
  const scale = 1 + (Math.max(1, zoom.depth) - 1) * e;
  if (scale === 1) return base;
  const focus = zoom.focus === 'cursor' ? centre : zoom.focus;
  const w = base.w / scale;
  const h = base.h / scale;
  const x = Math.min(base.x + base.w - w, Math.max(base.x, focus.x - w / 2));
  const y = Math.min(base.y + base.h - h, Math.max(base.y, focus.y - h / 2));
  return { x, y, w, h };
}

const sourceTime = (s: Source, rec: number) => rec - s.offset;
const covers = (s: Source, rec: number) => rec >= s.offset && rec < s.offset + s.duration;

/**
 * What the renderer draws at output time `out` of `cut`. Pure; preview and export share it.
 * `captions` are the project's caption lines (project/captions.ts captionLines), needed to draw captions.
 */
export function renderPlan(project: Project, cut: Cut, out: number, events?: EventsTrack, captions?: Caption[]): RenderPlan {
  const plan: RenderPlan = { out, rec: null, background: cut.look.background, overlays: [], cards: [], fade: 0 };
  const span = spanAt(cut, out);
  if (!span || span.clip.gap) return plan;
  const rec = span.clip.in + (out - span.start) * span.clip.speed;
  plan.rec = rec;
  const t = span.clip.transition;
  if (t && span.index > 0 && t.ms > 0 && out - span.start < t.ms) plan.fade = 1 - (out - span.start) / t.ms;

  const hidden = (track: string) => !!cut.tracks[track]?.hidden;
  const screenSrc = project.sources.find((s) => s.kind === 'screen') ?? project.sources.find((s) => s.kind === 'baked');
  const camSrc = project.sources.find((s) => s.kind === 'camera');
  const screenAspect = aspectOf(screenSrc, 16 / 9);
  const input = { shape: cut.shape, fit: cut.fit, look: cut.look, camera: cut.camera, screenAspect, cameraAspect: aspectOf(camSrc, 4 / 3) };
  const { from, to, progress } = layoutAt(cut, rec, !!camSrc);
  const a = arrange({ ...input, layout: from });
  const b = arrange({ ...input, layout: to });

  const pointer = project.events && events ? cursorAt(events.events, rec, cut.look.cursor.smooth) : null;

  const screenBox = b.screen && a.screen ? lerpBox(a.screen, b.screen, progress) : (b.screen ?? (progress < 1 ? a.screen : undefined));
  if (screenSrc && screenBox && covers(screenSrc, rec) && !hidden('screen')) {
    const crop = cropFor(cut, rec, screenBox, screenAspect, b.follow, pointer);
    plan.screen = { source: screenSrc.id, t: sourceTime(screenSrc, rec), crop, dest: screenBox, radius: cut.look.corners, shadow: cut.look.shadow };
    if (pointer && !hidden('cursor') && pointer.x >= crop.x && pointer.x <= crop.x + crop.w && pointer.y >= crop.y && pointer.y <= crop.y + crop.h) {
      plan.cursor = {
        x: screenBox.x + ((pointer.x - crop.x) / crop.w) * screenBox.w,
        y: screenBox.y + ((pointer.y - crop.y) / crop.h) * screenBox.h,
        size: cut.look.cursor.size, click: cut.look.cursor.clicks ? pointer.click : 0,
      };
    }
  }

  if (camSrc && covers(camSrc, rec) && !hidden('camera')) {
    const camBox = a.camera && b.camera ? lerpBox(a.camera, b.camera, progress) : (b.camera ?? a.camera);
    const alpha = a.camera && b.camera ? 1 : b.camera ? progress : 1 - progress;
    if (camBox && alpha > 0) {
      const { shape, mirror, blur } = cut.camera;
      plan.camera = { source: camSrc.id, t: sourceTime(camSrc, rec), dest: camBox, shape, mirror, blur, alpha };
    }
  }

  if (!hidden('overlays')) plan.overlays = cut.overlays.filter((o) => rec >= o.at && rec < o.end);
  if (!hidden('cards')) {
    plan.cards = cut.cards.filter((c) => {
      const start = toOut(cut, c.at);
      return start !== null && out >= start && out < start + c.ms;
    });
  }
  if (captions && cut.captions.show && !hidden('captions')) {
    const line = captionAt(captions, rec);
    const words = line?.words.filter((w) => toOut(cut, (w.start + w.end) / 2) !== null) ?? [];
    if (words.length) plan.captions = { words: words.map((w) => ({ text: w.text, on: w.start <= rec })), style: cut.captions };
  }
  if (!hidden('media')) {
    const placed = [...cut.media].reverse().find((m) => rec >= m.at && rec < m.at + (m.trim[1] - m.trim[0]));
    if (placed) plan.media = { source: placed.source, t: placed.trim[0] + rec - placed.at };
  }
  return plan;
}
