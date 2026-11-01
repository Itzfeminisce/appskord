import { describe, expect, it } from 'vitest';
import { blankCut } from '../project/cuts';
import type { Clip } from '../project/types';
import { DUCK, duckEnvelope, gainAt, speechRanges } from './duck';

const clip = (id: string, inMs: number, out: number, speed = 1): Clip => ({ id, in: inMs, out, speed });
const cut = (clips: Clip[]) => blankCut({ name: 'Full', clips, made: 'full' });
const w = (start: number, end: number) => ({ start, end, text: 'word' });

describe('duck envelope', () => {
  it('joins words across short pauses and maps them through cuts and speed', () => {
    const c = cut([clip('a', 0, 4000), clip('b', 6000, 10_000, 2)]);
    const words = [w(1000, 1300), w(1500, 1800), w(3000, 3200), w(5000, 5500), w(7000, 7400)];
    // 5000..5500 is cut away; 7000..7400 at 2x lands at 4000 + 500..700.
    expect(speechRanges(c, words)).toEqual([[1000, 1800], [3000, 3200], [4500, 4700]]);
  });

  it('dips to the duck depth while words play and comes back after', () => {
    const c = cut([clip('a', 0, 20_000)]);
    const env = duckEnvelope(c, [w(2000, 3000), w(10_000, 11_000)]);
    expect(env).toEqual([
      { t: 2000 - DUCK.attack, gain: 1 }, { t: 2000, gain: DUCK.depth }, { t: 3000, gain: DUCK.depth }, { t: 3000 + DUCK.release, gain: 1 },
      { t: 10_000 - DUCK.attack, gain: 1 }, { t: 10_000, gain: DUCK.depth }, { t: 11_000, gain: DUCK.depth }, { t: 11_000 + DUCK.release, gain: 1 },
    ]);
    expect(gainAt(env, 0)).toBe(1);
    expect(gainAt(env, 2500)).toBe(DUCK.depth);
    expect(gainAt(env, 2000 - DUCK.attack / 2)).toBeCloseTo((1 + DUCK.depth) / 2, 6);
    expect(gainAt(env, 5000)).toBe(1);
    expect(gainAt(env, 30_000)).toBe(1);
  });

  it('starts ducked when speech starts at 0 and does nothing without words', () => {
    const c = cut([clip('a', 0, 5000)]);
    expect(duckEnvelope(c, [w(0, 1000)])[0]).toEqual({ t: 0, gain: DUCK.depth });
    expect(gainAt(duckEnvelope(c, [w(0, 1000)]), 0)).toBe(DUCK.depth);
    expect(duckEnvelope(c, [])).toEqual([]);
  });

  it('keeps envelope times increasing when words sit just over a pause apart', () => {
    const c = cut([clip('a', 0, 20_000)]);
    const env = duckEnvelope(c, [w(1000, 1200), w(1900, 2000)]);
    expect(env.every((p, i) => i === 0 || p.t >= env[i - 1]!.t)).toBe(true);
  });
});
