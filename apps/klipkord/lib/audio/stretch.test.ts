import { describe, expect, it } from 'vitest';
import { stretch, Stretcher } from './stretch';

const SR = 48_000;
const sine = (freq: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / SR));
// Crossings per second over the middle, away from the edges.
const crossingRate = (x: Float32Array) => {
  const a = Math.floor(x.length * 0.2), b = Math.floor(x.length * 0.8);
  let n = 0;
  for (let i = a + 1; i < b; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++;
  return (n * SR) / (b - a);
};

describe('time-stretch', () => {
  it.each([1.5, 2, 0.5])('plays %sx as fast at the same pitch', (rate) => {
    const input = sine(440, 2);
    const [out] = stretch([input], rate, SR);
    expect(out!.length).toBe(Math.round(input.length / rate));
    expect(crossingRate(out!) / crossingRate(input)).toBeCloseTo(1, 1);
  });

  it('streams in pieces to the same output as all at once', () => {
    const input = [sine(220, 1), sine(330, 1)];
    const whole = stretch(input, 1.5, SR);
    const s = new Stretcher(1.5, SR, 2);
    const parts: Float32Array[][] = [];
    for (const blocks of [7, 13, 1, 20]) {
      const [lo, hi] = s.needs(blocks);
      const from = Math.max(0, lo);
      parts.push(s.next({ start: from, data: input.map((c) => c.slice(from, Math.max(from, hi))) }, blocks));
    }
    const joined = parts.flatMap((p) => [...p[1]!]);
    expect(joined).toEqual(Array.from(whole[1]!.subarray(0, joined.length)));
  });
});
