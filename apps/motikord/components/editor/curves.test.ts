import { describe, expect, it } from 'vitest';
import { FEEL } from '@appskord/motion/curves';
import type { Curve } from '@appskord/motion/types';
import { curveArea, curvePath, dragHandle, EDITOR_BOX, handles, motionSegments, toBox } from './curves';
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
