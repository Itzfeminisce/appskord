import { describe, expect, it } from 'vitest';
import { dampingRatio, springAt, springEase } from '../src/springs';

const samples = (f: (u: number) => number) => Array.from({ length: 201 }, (_, i) => f(i / 200));

describe('springs', () => {
  it('reads bounce as damping: 0% is critical, 50% is half', () => {
    expect(dampingRatio(0)).toBe(1);
    expect(dampingRatio(50)).toBe(0.5);
    expect(dampingRatio(500)).toBeCloseTo(0.05, 10);
  });

  it('starts at rest, settles on exactly 1 at the settle time', () => {
    for (const bounce of [0, 20, 50, 90]) {
      const f = springEase(bounce);
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      expect(Math.abs(f(0.999) - 1)).toBeLessThan(2e-3);
      expect(f(0.001)).toBeLessThan(0.01);
    }
  });

  it('overshoots with bounce and never without', () => {
    expect(Math.max(...samples(springEase(50)))).toBeGreaterThan(1.05);
    const still = samples(springEase(0));
    expect(Math.max(...still)).toBeLessThanOrEqual(1);
    still.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(still[i] as number));
  });

  it('measures time against the settle length', () => {
    expect(springAt(50, 700, 350)).toBe(springEase(50)(0.5));
    expect(springAt(50, 700, 700)).toBe(1);
    expect(springAt(50, 0, 10)).toBe(1);
  });
});
