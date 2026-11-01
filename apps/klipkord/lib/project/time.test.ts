import { describe, expect, it } from 'vitest';
import { clipLength, cutLength, isKept, spanAt, spans, toOut, toRec } from './time';
import type { Clip, Cut } from './types';

const cut = (clips: Clip[]) => ({ clips }) as Cut;
const clip = (id: string, a: number, b: number, speed = 1, gap?: boolean): Clip => ({ id, in: a, out: b, speed, ...(gap && { gap }) });

describe('project time', () => {
  // 0..1000 at 1x, 2000..4000 at 2x (1000 ms out), a 500 ms gap, 5000..5500 at 0.5x (1000 ms out).
  const c = cut([clip('a', 0, 1000), clip('b', 2000, 4000, 2), clip('g', 0, 500, 1, true), clip('c', 5000, 5500, 0.5)]);

  it('measures clips and cuts with speed', () => {
    expect(clipLength(c.clips[1]!)).toBe(1000);
    expect(clipLength(c.clips[3]!)).toBe(1000);
    expect(cutLength(c)).toBe(3500);
    expect(spans(c).map((s) => [s.start, s.end])).toEqual([[0, 1000], [1000, 2000], [2000, 2500], [2500, 3500]]);
  });

  it('maps output to recording time through speed, gaps and the end', () => {
    expect(toRec(c, 0)).toBe(0);
    expect(toRec(c, 999)).toBe(999);
    expect(toRec(c, 1000)).toBe(2000);
    expect(toRec(c, 1500)).toBe(3000);
    expect(toRec(c, 2200)).toBeNull();
    expect(toRec(c, 3000)).toBe(5250);
    expect(toRec(c, 3500)).toBeNull();
    expect(toRec(c, -1)).toBeNull();
    expect(spanAt(c, 2200)?.clip.id).toBe('g');
  });

  it('maps recording to output time, null when cut away', () => {
    expect(toOut(c, 500)).toBe(500);
    expect(toOut(c, 1500)).toBeNull();
    expect(toOut(c, 3000)).toBe(1500);
    expect(toOut(c, 5250)).toBe(3000);
    expect(toOut(c, 5500)).toBeNull();
    expect(isKept(c, 4500)).toBe(false);
  });

  it('round-trips every kept moment', () => {
    for (const out of [0, 250, 1250, 1999, 2600, 3400]) expect(toOut(c, toRec(c, out)!)).toBeCloseTo(out);
  });

  it('plays a moved range where it now sits and a duplicate from its first play', () => {
    const moved = cut([clip('b', 1000, 2000), clip('a', 0, 1000), clip('dup', 0, 1000)]);
    expect(toOut(moved, 500)).toBe(1500);
    expect(toRec(moved, 2500)).toBe(500);
  });
});
