import { describe, expect, it } from 'vitest';
import { hierarchyStarts, layerMs, layerStarts, OVERLAP_MS, splitUnits, stagger, staggeredMs } from '../src/choreo';
import type { LayerV3 } from '../src/types';

const layer = (id: string, end: number, start?: number): LayerV3 => ({
  id,
  kind: 'text',
  depth: 'front',
  start,
  tracks: {
    opacity: [
      { t: 0, v: 0 },
      { t: end, v: 1 },
    ],
  },
});

describe('choreography', () => {
  it('staggers 40 ms a letter, 90 ms a word, 120 ms a line', () => {
    expect(stagger(4, 'letter')).toEqual([0, 40, 80, 120]);
    expect(stagger(3, 'word')).toEqual([0, 90, 180]);
    expect(stagger(2, 'line')).toEqual([0, 120]);
    expect(stagger(3, 'word', 60)).toEqual([0, 60, 120]);
    expect(stagger(0, 'letter')).toEqual([]);
  });

  it('splits text into letters, words and lines', () => {
    expect(splitUnits('Good coffee', 'letter')).toHaveLength(10);
    expect(splitUnits('Good coffee, fast', 'word')).toEqual(['Good', 'coffee,', 'fast']);
    expect(splitUnits('Opens at seven\nand stays', 'line')).toEqual(['Opens at seven', 'and stays']);
  });

  it('starts each level 40 ms before the one above it ends', () => {
    expect(OVERLAP_MS).toBe(40);
    // Kicker 360, headline of 6 words at 300 ms stepping 60, body 360, button 300 (MotionV3 row 03).
    const headline = staggeredMs(300, 6, 60);
    expect(headline).toBe(600);
    expect(hierarchyStarts([360, headline, 360, 300])).toEqual([0, 320, 880, 1200]);
  });

  it('times layers by hierarchy unless they set a start', () => {
    const layers = [layer('a', 400), layer('b', 300), layer('c', 200, 0), layer('d', 100)];
    expect(layerMs(layers[0] as LayerV3)).toBe(400);
    expect(layerStarts(layers)).toEqual([0, 360, 0, 160]);
  });
});
