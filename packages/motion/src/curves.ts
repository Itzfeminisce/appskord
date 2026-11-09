import BezierEasing from 'bezier-easing';
import { springEase } from './springs';
import type { Curve, Feel, Key, Track } from './types';

/** The five motion feels as drawn in MotionV3: a curve and its natural length in ms. */
export const FEEL: Readonly<Record<Feel, { curve: Curve; ms: number }>> = {
  smooth: { curve: { kind: 'bezier', p: [0.22, 1, 0.36, 1] }, ms: 600 },
  snappy: { curve: { kind: 'bezier', p: [0.2, 0, 0, 1] }, ms: 320 },
  steady: { curve: { kind: 'bezier', p: [0.45, 0, 0.55, 1] }, ms: 500 },
  floaty: { curve: { kind: 'bezier', p: [0.5, 0, 0.1, 1] }, ms: 1200 },
  bouncy: { curve: { kind: 'spring', bounce: 50, ms: 700 }, ms: 700 },
};

export const LINEAR: Curve = { kind: 'bezier', p: [0, 0, 1, 1] };

const cache = new Map<string, (x: number) => number>();

/** The easing function for a curve: progress 0..1 in, eased progress out. */
export function ease(curve: Curve): (x: number) => number {
  const id = curve.kind === 'bezier' ? `b${curve.p.join(',')}` : `s${curve.bounce}`;
  let fn = cache.get(id);
  if (!fn) {
    if (curve.kind === 'spring') fn = springEase(curve.bounce);
    else {
      const b = BezierEasing(...curve.p);
      fn = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : b(x));
    }
    cache.set(id, fn);
  }
  return fn;
}

/** The label the editor shows for a curve, as in the frames. */
export function curveLabel(curve: Curve): string {
  if (curve.kind === 'spring') return `Spring · ${curve.bounce}% bounce`;
  return `Curve ${curve.p.join(' · ')}`;
}

/** A track's value at `t` ms from the layer's start. A key's curve shapes the approach to that key. */
export function valueAt(track: Track<number>, t: number, fallback: Curve = FEEL.smooth.curve): number {
  const first = track[0];
  if (!first) return Number.NaN;
  if (t <= first.t) return first.v;
  for (let i = 1; i < track.length; i++) {
    const b = track[i] as Key<number>;
    if (t < b.t) {
      const a = track[i - 1] as Key<number>;
      const p = (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * ease(b.curve ?? fallback)(p);
    }
  }
  return (track[track.length - 1] as Key<number>).v;
}

/** The time of a track's last key: when its motion is done. */
export function trackEnd(track: Track<number>): number {
  return track.length ? (track[track.length - 1] as Key<number>).t : 0;
}
