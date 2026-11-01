import type { Clip, Cut } from './types';

/** One clip placed on the output timeline: it plays from `start` to `end` (output ms). */
export interface Span { clip: Clip; index: number; start: number; end: number }

/** Output length of one clip: its recording range divided by its speed; a gap keeps its length. */
export function clipLength(clip: Clip): number {
  const len = Math.max(0, clip.out - clip.in);
  return clip.gap ? len : len / clip.speed;
}

/** Every clip of the cut with its output span, in play order. */
export function spans(cut: Cut): Span[] {
  let t = 0;
  return cut.clips.map((clip, index) => {
    const start = t;
    t += clipLength(clip);
    return { clip, index, start, end: t };
  });
}

/** Length of the edited video of one cut, ms. */
export function cutLength(cut: Cut): number {
  return cut.clips.reduce((sum, c) => sum + clipLength(c), 0);
}

/** The clip playing at an output time, or null past the end. */
export function spanAt(cut: Cut, out: number): Span | null {
  if (out < 0) return null;
  return spans(cut).find((s) => out >= s.start && out < s.end) ?? null;
}

/** Output time → recording time; null in a gap or past the end. */
export function toRec(cut: Cut, out: number): number | null {
  const s = spanAt(cut, out);
  if (!s || s.clip.gap) return null;
  return s.clip.in + (out - s.start) * s.clip.speed;
}

/** Recording time → output time; null when that moment is cut away. The first clip that plays it wins. */
export function toOut(cut: Cut, rec: number): number | null {
  for (const s of spans(cut)) {
    if (!s.clip.gap && rec >= s.clip.in && rec < s.clip.out) return s.start + (rec - s.clip.in) / s.clip.speed;
  }
  return null;
}

/** True when the recording moment plays in this cut. */
export const isKept = (cut: Cut, rec: number): boolean => toOut(cut, rec) !== null;
