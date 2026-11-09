import { describe, expect, it } from 'vitest';
import { curveLabel, ease, FEEL, LINEAR, trackEnd, valueAt } from '../src/curves';

describe('curves', () => {
  it('maps the five feels to the curves drawn in MotionV3', () => {
    expect(curveLabel(FEEL.smooth.curve)).toBe('Curve 0.22 · 1 · 0.36 · 1');
    expect(curveLabel(FEEL.snappy.curve)).toBe('Curve 0.2 · 0 · 0 · 1');
    expect(curveLabel(FEEL.steady.curve)).toBe('Curve 0.45 · 0 · 0.55 · 1');
    expect(curveLabel(FEEL.floaty.curve)).toBe('Curve 0.5 · 0 · 0.1 · 1');
    expect(curveLabel(FEEL.bouncy.curve)).toBe('Spring · 50% bounce');
    expect([FEEL.smooth.ms, FEEL.snappy.ms, FEEL.steady.ms, FEEL.floaty.ms, FEEL.bouncy.ms]).toEqual([
      600, 320, 500, 1200, 700,
    ]);
  });

  it('starts at 0, ends at 1 and clamps outside 0..1', () => {
    for (const { curve } of Object.values(FEEL)) {
      const f = ease(curve);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(f(-1)).toBe(0);
      expect(f(2)).toBe(1);
    }
  });

  it('is linear for the linear curve and symmetric for steady', () => {
    expect(ease(LINEAR)(0.3)).toBeCloseTo(0.3, 5);
    expect(ease(FEEL.steady.curve)(0.5)).toBeCloseTo(0.5, 5);
    expect(ease(FEEL.snappy.curve)(0.25)).toBeGreaterThan(0.5);
  });

  it('interpolates a track, using the curve on the key it approaches', () => {
    const track = [
      { t: 0, v: 0 },
      { t: 100, v: 10, curve: LINEAR },
      { t: 300, v: 30, curve: FEEL.steady.curve },
    ];
    expect(valueAt(track, -50)).toBe(0);
    expect(valueAt(track, 50)).toBeCloseTo(5, 5);
    expect(valueAt(track, 200)).toBeCloseTo(20, 5);
    expect(valueAt(track, 999)).toBe(30);
    expect(trackEnd(track)).toBe(300);
    expect(valueAt([], 0)).toBeNaN();
  });
});
