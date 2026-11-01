import { describe, expect, it } from 'vitest';
import { ease, MAX_ZOOM_RATE, omega, PEAK_SLOPE, rampMs, SETTLE_MS, springStep } from './spring';

describe('spring', () => {
  it('eases from 0 to exactly 1 without overshoot', () => {
    expect(ease(-1)).toBe(0);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(2)).toBe(1);
    let prev = 0;
    for (let p = 0.01; p <= 1; p += 0.01) {
      const v = ease(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(ease(0.5)).toBeGreaterThan(0.9);
  });

  it('settles each feel in its time, snappy first', () => {
    expect(SETTLE_MS.snappy).toBeLessThan(SETTLE_MS.smooth);
    expect(SETTLE_MS.smooth).toBeLessThan(SETTLE_MS.calm);
    for (const feel of ['calm', 'smooth', 'snappy'] as const) {
      const w = omega(SETTLE_MS[feel]);
      let s = { x: 0, v: 0 };
      for (let t = 0; t < SETTLE_MS[feel]; t += 10) s = springStep(s, 1, 10, w);
      expect(s.x).toBeGreaterThan(0.998);
      expect(s.x).toBeLessThanOrEqual(1);
      expect(Math.abs(s.v)).toBeLessThan(1e-4);
    }
  });

  it('steps exactly: two half steps equal one whole step', () => {
    const w = omega(300);
    const once = springStep({ x: 0.2, v: 0.003 }, 1, 80, w);
    const twice = springStep(springStep({ x: 0.2, v: 0.003 }, 1, 40, w), 1, 40, w);
    expect(twice.x).toBeCloseTo(once.x, 10);
    expect(twice.v).toBeCloseTo(once.v, 10);
    expect(springStep({ x: 0.2, v: 0 }, 1, 0, w)).toEqual({ x: 0.2, v: 0 });
  });

  it('stretches a deep zoom so it never passes the speed cap', () => {
    expect(rampMs(1.5, 'smooth')).toBe(SETTLE_MS.smooth);
    const deep = rampMs(4, 'snappy');
    expect(deep).toBeGreaterThan(SETTLE_MS.snappy);
    expect((Math.log(4) * PEAK_SLOPE * 1000) / deep).toBeCloseTo(MAX_ZOOM_RATE);
  });
});
