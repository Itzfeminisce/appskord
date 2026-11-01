// "Lower music while you talk": a gain envelope for the music, in output ms, from transcript word timings.
import type { Word } from '../types';
import type { Cut } from '../project/types';
import { spans } from '../project/time';

export interface Point { t: number; gain: number }   // output ms, linear gain
export interface DuckOptions { depth: number; attack: number; release: number; bridge: number }

/** About -12 dB under speech; pauses shorter than `bridge` stay ducked so the music doesn't pump between words. */
export const DUCK: DuckOptions = { depth: 0.25, attack: 120, release: 450, bridge: 600 };

/** Output ranges where words are heard in this cut, merged across short pauses. */
export function speechRanges(cut: Cut, words: Word[], bridge = DUCK.bridge): [number, number][] {
  const ranges: [number, number][] = [];
  for (const s of spans(cut)) {
    if (s.clip.gap) continue;
    for (const w of words) {
      const from = Math.max(w.start, s.clip.in);
      const to = Math.min(w.end, s.clip.out);
      if (to > from) ranges.push([s.start + (from - s.clip.in) / s.clip.speed, s.start + (to - s.clip.in) / s.clip.speed]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= bridge) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Envelope points (linear ramps between them) that dip to `depth` over each speech range. Empty: no ducking. */
export function duckEnvelope(cut: Cut, words: Word[], options: Partial<DuckOptions> = {}): Point[] {
  const o = { ...DUCK, ...options };
  // Ranges closer than a full dip and recovery are joined, so ramps never cross.
  const ranges = speechRanges(cut, words, Math.max(o.bridge, o.attack + o.release));
  const points: Point[] = [];
  for (const [from, to] of ranges) {
    const down = Math.max(0, from - o.attack);
    if (down > 0) points.push({ t: down, gain: 1 });
    points.push({ t: from > 0 ? from : 0, gain: o.depth }, { t: to, gain: o.depth }, { t: to + o.release, gain: 1 });
  }
  return points;
}

/** Envelope value at an output time; 1 before the first point and after the last. */
export function gainAt(points: Point[], t: number): number {
  const first = points[0];
  if (!first || t < first.t) return 1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (t < b.t) return b.t === a.t ? b.gain : a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1]!.gain;
}
