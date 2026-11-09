import { ease, FEEL } from '@appskord/motion/curves';
import type { Curve, Feel, LayerV3, SceneV3 } from '@appskord/motion/types';
import { feelOf, localEnd, OUT_MS, readMotion } from './edits';

// The easing curve as drawn: in the Motion tab's curve editor and on the timeline's layer rows.

/** Where a curve is drawn: value 0 sits on the bottom edge, value 1 on the top. */
export interface CurveBox { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }

/** The curve editor's box inside its 266 × 64 drawing (the EditorMotion frame). */
export const EDITOR_BOX: CurveBox = { left: 14, top: 10, width: 240, height: 46 };
const SPRING_STEPS = 32;

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A point of the curve's unit square in the box; `out` runs from the top down. */
export function toBox(b: CurveBox, x: number, v: number, dir: 'in' | 'out' = 'in'): Point {
  const y = dir === 'in' ? b.top + b.height * (1 - v) : b.top + b.height * v;
  return { x: r1(b.left + b.width * x), y: r1(y) };
}

/** The SVG path of an easing curve across the box: a cubic for a bezier, sampled for a spring. */
export function curvePath(curve: Curve, b: CurveBox, dir: 'in' | 'out' = 'in'): string {
  const at = (x: number, v: number) => toBox(b, x, v, dir);
  const p0 = at(0, 0);
  const p1 = at(1, 1);
  if (curve.kind === 'bezier') {
    const [h1, h2] = handles(curve, b, dir);
    return `M${p0.x} ${p0.y} C${h1.x} ${h1.y}, ${h2.x} ${h2.y}, ${p1.x} ${p1.y}`;
  }
  const f = ease(curve);
  const pts = Array.from({ length: SPRING_STEPS + 1 }, (_, k) => at(k / SPRING_STEPS, f(k / SPRING_STEPS)));
  return pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
}

/** The same path closed down to the box's bottom edge, for the timeline's shaded area. */
export function curveArea(curve: Curve, b: CurveBox, dir: 'in' | 'out' = 'in', floor = b.top + b.height): string {
  const right = r1(b.left + b.width);
  return `${curvePath(curve, b, dir)} L${right} ${floor} L${r1(b.left)} ${floor} Z`;
}

/** A bezier's two handles in the box. */
export function handles(curve: Extract<Curve, { kind: 'bezier' }>, b: CurveBox, dir: 'in' | 'out' = 'in'): [Point, Point] {
  const [x1, y1, x2, y2] = curve.p;
  return [toBox(b, x1, y1, dir), toBox(b, x2, y2, dir)];
}

/** Moves one handle to a point in the box (kept inside it); the other stays. */
export function dragHandle(curve: Extract<Curve, { kind: 'bezier' }>, which: 0 | 1, at: Point, b: CurveBox): Extract<Curve, { kind: 'bezier' }> {
  const x = Math.round(clamp01((at.x - b.left) / b.width) * 100) / 100;
  const v = Math.round(clamp01(1 - (at.y - b.top) / b.height) * 100) / 100;
  const p: [number, number, number, number] = [...curve.p];
  p[which * 2] = x;
  p[which * 2 + 1] = v;
  return { kind: 'bezier', p };
}

type Bezier = Extract<Curve, { kind: 'bezier' }>;

/** What each feel's curve does (CurveLabelsV3); Bouncy is a spring and reads "Spring · {bounce}% bounce". */
export const FEEL_LINES: Readonly<Record<Exclude<Feel, 'bouncy'>, string>> = {
  smooth: 'Quick start, soft landing',
  snappy: 'Snaps in, then settles',
  steady: 'Slow start, soft landing',
  floaty: 'Slow start, long glide',
};
export const CUSTOM_CURVE = 'Custom curve';
export const springLine = (bounce: number) => `Spring · ${bounce}% bounce`;
/** How close each handle must be to a feel's to snap to it. */
export const SNAP = 0.02;
const BEZIER_FEELS = Object.keys(FEEL_LINES) as Exclude<Feel, 'bouncy'>[];

/** The feel whose curve the handles are within SNAP of, if any. */
export function nearFeel(c: Bezier): Exclude<Feel, 'bouncy'> | undefined {
  return BEZIER_FEELS.find((f) => {
    const p = (FEEL[f].curve as Bezier).p;
    return p.every((v, k) => Math.abs(v - c.p[k]!) <= SNAP + 1e-9);
  });
}

/** The feel a curve reads as: the spring feel exactly, a bezier within SNAP of a feel's handles. */
export function feelNear(c: Curve): Feel | undefined {
  return c.kind === 'spring' ? feelOf(c) : nearFeel(c);
}

/** Handles near a feel's curve take that curve exactly; any other shape stays as it is. */
export function snapToFeel(c: Bezier): Bezier {
  const f = nearFeel(c);
  return f ? (FEEL[f].curve as Bezier) : c;
}

/** The curve editor's label: the feel's line, the spring's bounce, or "Custom curve". */
export function curveLabel(c: Curve): string {
  if (c.kind === 'spring') return springLine(c.bounce);
  const f = nearFeel(c);
  return f ? FEEL_LINES[f] : CUSTOM_CURVE;
}

/** What a screen reader hears for the curve editor. */
export function curveAria(c: Curve): string {
  if (c.kind === 'spring') return `Spring editor: ${c.bounce}% bounce. Drag the dot to change the bounce.`;
  const l = curveLabel(c);
  return `Curve editor: ${l[0]!.toLowerCase()}${l.slice(1)}. Drag the two handles.`;
}

const peaks = new Map<number, number[]>();
/** A spring's highest point (its overshoot) as a fraction of the way through: [x, value]. */
export function springPeak(c: Extract<Curve, { kind: 'spring' }>): [number, number] {
  const f = ease(c);
  let best: [number, number] = [1, 1];
  for (let k = 1; k <= SPRING_STEPS; k++) {
    const v = f(k / SPRING_STEPS);
    if (v > best[1] + 1e-9) best = [k / SPRING_STEPS, v];
  }
  return best;
}

/** The bounce (0–100) whose overshoot reaches nearest to `value`: dragging the spring's dot. */
export function bounceFor(c: Extract<Curve, { kind: 'spring' }>, value: number): number {
  let table = peaks.get(c.ms);
  if (!table) {
    table = Array.from({ length: 101 }, (_, b) => springPeak({ ...c, bounce: b })[1]);
    peaks.set(c.ms, table);
  }
  let best = 0;
  table.forEach((v, b) => { if (Math.abs(v - value) < Math.abs(table![best]! - value)) best = b; });
  return best;
}

export interface MotionSegment { from: number; to: number; curve: Curve; dir: 'in' | 'out' }

/** The layer's entrance and, when it fades or masks out, its exit: ms from the layer's start. */
export function motionSegments(scene: SceneV3, layer: LayerV3): MotionSegment[] {
  const m = readMotion(scene, layer);
  const out: MotionSegment[] = [];
  if (m.ms > 0) out.push({ from: 0, to: m.ms, curve: m.curve, dir: 'in' });
  if (m.out === 'fade' || m.out === 'mask') {
    const end = localEnd(scene, layer);
    out.push({ from: Math.max(m.ms, end - OUT_MS), to: end, curve: m.curve, dir: 'out' });
  }
  return out;
}
