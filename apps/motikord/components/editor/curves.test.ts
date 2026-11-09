import { describe, expect, it } from 'vitest';
import { FEEL } from '@appskord/motion/curves';
import type { Curve } from '@appskord/motion/types';
import { bounceFor, curveAria, curveArea, curveLabel, curvePath, dragHandle, EDITOR_BOX, handles, motionSegments, feelNear, nearFeel, snapToFeel, springPeak, toBox } from './curves';
import { readMotion, writeMotion } from './edits';
import { sampleClip } from './fixture';

const box = { left: 0, top: 0, width: 100, height: 10 };
const smooth = FEEL.smooth.curve as Extract<Curve, { kind: 'bezier' }>;

describe('curve drawing', () => {
  it('draws a bezier as one cubic from bottom left to top right, and an exit from top to bottom', () => {
    expect(curvePath({ kind: 'bezier', p: [0.25, 0, 0.75, 1] }, box)).toBe('M0 10 C25 10, 75 0, 100 0');
    expect(curvePath({ kind: 'bezier', p: [0.25, 0, 0.75, 1] }, box, 'out')).toBe('M0 0 C25 0, 75 10, 100 10');
  });

  it('samples a spring and ends at its rest value', () => {
    const d = curvePath({ kind: 'spring', bounce: 40, ms: 600 }, box);
    expect(d.startsWith('M0 10 L')).toBe(true);
    expect(d.split('L')).toHaveLength(33);
    expect(d.endsWith('100 0')).toBe(true);
  });

  it('closes the shaded area down to the floor', () => {
    expect(curveArea(smooth, box, 'in', 20)).toMatch(/ L100 20 L0 20 Z$/);
  });

  it('puts the handles where the bezier points are, and a drag moves only the held one, kept in the box', () => {
    const [a, b] = handles(smooth, EDITOR_BOX);
    expect(a).toEqual(toBox(EDITOR_BOX, smooth.p[0], smooth.p[1]));
    expect(b).toEqual(toBox(EDITOR_BOX, smooth.p[2], smooth.p[3]));
    const moved = dragHandle(smooth, 0, { x: EDITOR_BOX.left + EDITOR_BOX.width / 2, y: EDITOR_BOX.top + EDITOR_BOX.height }, EDITOR_BOX);
    expect(moved.p).toEqual([0.5, 0, smooth.p[2], smooth.p[3]]);
    const out = dragHandle(smooth, 1, { x: 999, y: -999 }, EDITOR_BOX);
    expect(out.p).toEqual([smooth.p[0], smooth.p[1], 1, 1]);
  });
});

describe('motionSegments', () => {
  const clip = sampleClip();
  const scene = clip.v3.scenes[0]!;
  const layer = scene.layers.find((l) => l.slotId === 'headline')!;

  it('gives the entrance with the layer’s curve', () => {
    const m = readMotion(scene, layer);
    expect(motionSegments(scene, layer)[0]).toEqual({ from: 0, to: m.ms, curve: m.curve, dir: 'in' });
  });

  it('adds the exit when the layer fades out', () => {
    const faded = writeMotion(scene, layer, { ...readMotion(scene, layer), out: 'fade' });
    const s = { ...scene, layers: scene.layers.map((l) => (l.id === layer.id ? faded : l)) };
    const segs = motionSegments(s, faded);
    expect(segs.map((x) => x.dir)).toEqual(['in', 'out']);
    expect(segs[1]!.to).toBeGreaterThan(segs[1]!.from);
  });
});

describe('curve labels (CurveLabelsV3)', () => {
  it('names each feel curve by its shape, and a spring by its bounce', () => {
    expect(curveLabel(FEEL.smooth.curve)).toBe('Quick start, soft landing');
    expect(curveLabel(FEEL.snappy.curve)).toBe('Snaps in, then settles');
    expect(curveLabel(FEEL.steady.curve)).toBe('Slow start, soft landing');
    expect(curveLabel(FEEL.floaty.curve)).toBe('Slow start, long glide');
    expect(curveLabel(FEEL.bouncy.curve)).toBe('Spring · 50% bounce');
    expect(curveLabel({ kind: 'bezier', p: [0.7, 0.1, 0.3, 0.95] })).toBe('Custom curve');
  });

  it('snaps handles within 0.02 of a feel to that feel, and leaves other shapes alone', () => {
    expect(snapToFeel({ kind: 'bezier', p: [0.24, 0.98, 0.35, 1] })).toBe(FEEL.smooth.curve);
    expect(nearFeel({ kind: 'bezier', p: [0.2, 0.02, 0.02, 0.98] })).toBe('snappy');
    const off = { kind: 'bezier', p: [0.25, 1, 0.36, 1] } as const;
    expect(snapToFeel({ ...off, p: [...off.p] })).toEqual(off);
    expect(curveLabel(off as never)).toBe('Custom curve');
  });

  it('says the label to screen readers', () => {
    expect(curveAria(FEEL.steady.curve)).toBe('Curve editor: slow start, soft landing. Drag the two handles.');
    expect(curveAria({ kind: 'bezier', p: [0.7, 0.1, 0.3, 0.95] })).toBe('Curve editor: custom curve. Drag the two handles.');
    expect(curveAria({ kind: 'spring', bounce: 50, ms: 700 })).toBe('Spring editor: 50% bounce. Drag the dot to change the bounce.');
  });

  it('drags the spring dot to the bounce whose overshoot reaches it', () => {
    const spring = { kind: 'spring', bounce: 50, ms: 700 } as const;
    const [, peak] = springPeak(spring);
    expect(peak).toBeGreaterThan(1);
    expect(bounceFor(spring, peak)).toBe(50);
    expect(bounceFor(spring, 0.5)).toBe(0);
    expect(springPeak({ ...spring, bounce: 80 })[1]).toBeGreaterThan(peak);
  });

  it('reads a feel the same way everywhere: near for beziers, exact for the spring', () => {
    const near = { kind: 'bezier', p: [...(FEEL.steady.curve as { p: number[] }).p.map((v, k) => (k === 0 ? v + 0.01 : v))] } as Curve;
    expect(feelNear(near)).toBe('steady');
    expect(feelNear(FEEL.bouncy.curve)).toBe('bouncy');
    expect(feelNear({ kind: 'bezier', p: [0.7, 0.1, 0.3, 0.95] })).toBeUndefined();
  });
});
