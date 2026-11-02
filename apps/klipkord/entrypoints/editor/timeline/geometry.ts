import { spans, type Span } from '@/lib/project/time';
import type { Cut } from '@/lib/project/types';

/** The visible part of the timeline, output ms. */
export interface View { start: number; end: number }

/** The narrowest view the zoom slider reaches. */
export const MIN_VIEW_MS = 5_000;
/** Width of the track names column. */
export const HEAD_PX = 132;

export const xOf = (t: number, view: View, width: number): number => ((t - view.start) / Math.max(1, view.end - view.start)) * width;
export const tOf = (x: number, view: View, width: number): number => view.start + (x / Math.max(1, width)) * (view.end - view.start);
export const msPerPx = (view: View, width: number): number => (view.end - view.start) / Math.max(1, width);

/** The whole video, never shorter than the narrowest view. */
export const fitView = (length: number): View => ({ start: 0, end: Math.max(MIN_VIEW_MS, length) });

/** Keeps a view inside 0..length (plus the narrowest width) with its span between MIN_VIEW_MS and the whole video. */
export function clampView(view: View, length: number): View {
  const total = Math.max(MIN_VIEW_MS, length);
  const span = Math.min(total, Math.max(MIN_VIEW_MS, view.end - view.start));
  const start = Math.min(Math.max(0, view.start), total - span);
  return { start, end: start + span };
}

/** Zoom slider position 0 (whole video) .. 1 (narrowest), on a log scale so each step feels the same. */
export function sliderOf(view: View, length: number): number {
  const total = Math.max(MIN_VIEW_MS, length);
  if (total <= MIN_VIEW_MS) return 0;
  return Math.log(total / (view.end - view.start)) / Math.log(total / MIN_VIEW_MS);
}

/** The view at slider position `v`, centred on `around` (output ms). */
export function viewAtSlider(v: number, length: number, around: number): View {
  const total = Math.max(MIN_VIEW_MS, length);
  const span = total / Math.pow(total / MIN_VIEW_MS, Math.min(1, Math.max(0, v)));
  return clampView({ start: around - span / 2, end: around + span / 2 }, length);
}

const STEPS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000];

/** Ruler label times: the smallest round step that leaves at least `minPx` between labels. */
export function ticks(view: View, width: number, minPx = 64): number[] {
  const per = msPerPx(view, width);
  const step = STEPS.find((s) => s / per >= minPx) ?? STEPS[STEPS.length - 1]!;
  const out: number[] = [];
  for (let t = Math.ceil(view.start / step) * step; t <= view.end; t += step) out.push(t);
  return out;
}

/** True when output range a..b shows in the view: what gets drawn, so a 30-minute recording draws only what is on screen. */
export const inView = (a: number, b: number, view: View): boolean => b > view.start && a < view.end;

/** The output pieces where recording range `from`..`to` plays in this cut: one per clip that plays part of it. */
export function pieces(clipSpans: readonly Span[], from: number, to: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const s of clipSpans) {
    const c = s.clip;
    if (c.gap) continue;
    const a = Math.max(from, c.in);
    const b = Math.min(to, c.out);
    if (b <= a) continue;
    out.push({ start: s.start + (a - c.in) / c.speed, end: s.start + (b - c.in) / c.speed });
  }
  return out;
}

/** Output time where recording time `rec` first plays, or where the next kept part starts when it is cut away. */
export function outAtOrAfter(clipSpans: readonly Span[], rec: number): number | null {
  let next: number | null = null;
  for (const s of clipSpans) {
    const c = s.clip;
    if (c.gap) continue;
    if (rec >= c.in && rec < c.out) return s.start + (rec - c.in) / c.speed;
    if (c.in > rec && (next === null || s.start < next)) next = s.start;
  }
  return next;
}

/** Where a dragged clip lands, as moveRange's `at`: before the first other clip whose middle is past the drop time, else the end. */
export function dropAt(cut: Cut, dragged: string, at: number): number {
  const all = spans(cut);
  const next = all.find((s) => s.clip.id !== dragged && s.start + (s.end - s.start) / 2 > at);
  return next ? next.start : (all[all.length - 1]?.end ?? 0);
}
