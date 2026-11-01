import { describe, expect, it } from 'vitest';
import type { Feel } from '../types';
import { ease } from './easing';

const FEELS: Feel[] = ['smooth', 'snappy', 'bouncy', 'steady'];
const steps = Array.from({ length: 101 }, (_, i) => i / 100);

describe('easing', () => {
  it.each(FEELS)('%s starts at 0 and ends at 1', (feel) => {
    expect(ease(feel, 0)).toBe(0);
    expect(ease(feel, 1)).toBe(1);
  });

  it.each(FEELS)('%s clamps progress outside 0..1', (feel) => {
    expect(ease(feel, -2)).toBe(0);
    expect(ease(feel, 3)).toBe(1);
  });

  it.each(['smooth', 'snappy', 'steady'] as Feel[])('%s never goes backwards', (feel) => {
    const v = steps.map((t) => ease(feel, t));
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]!);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
  });

  it('bouncy rises to an overshoot past 1 and then settles', () => {
    const v = steps.map((t) => ease('bouncy', t));
    const peak = v.indexOf(Math.max(...v));
    expect(v[peak]!).toBeGreaterThan(1);
    for (let i = 1; i <= peak; i++) expect(v[i]!).toBeGreaterThanOrEqual(v[i - 1]!);
    for (let i = peak + 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]!);
  });

  it('snappy is ahead of smooth early on, steady is linear', () => {
    expect(ease('snappy', 0.2)).toBeGreaterThan(ease('smooth', 0.2));
    expect(ease('steady', 0.37)).toBeCloseTo(0.37);
  });
});
