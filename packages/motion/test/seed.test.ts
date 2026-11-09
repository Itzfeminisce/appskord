import { describe, expect, it } from 'vitest';
import { seeded, withRandom } from '../src/seed';

describe('seeded', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = seeded(7);
    const b = seeded(7);
    const xs = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seeded(8)()).not.toBe(xs[0]);
  });

  it('swaps Math.random only while the callback runs', () => {
    const original = Math.random;
    const value = withRandom(() => 0.25, () => Math.random());
    expect(value).toBe(0.25);
    expect(Math.random).toBe(original);
  });
});
