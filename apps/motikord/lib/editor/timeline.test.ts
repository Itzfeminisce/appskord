import { describe, expect, it } from 'vitest';
import { validateRecipe } from '../recipe/validate';
import { applyPatch } from '../patch';
import { devSampleRecipe } from './store';
import { dragSpan, layerTiming, MIN_LAYER_MS, sceneTargets, sceneTiming, snap, ticks, tracks } from './timeline';

const r = devSampleRecipe('t');

describe('timeline maths', () => {
  it('snaps to the tenth, then to a near target', () => {
    expect(snap(1234)).toBe(1200);
    expect(snap(1960, [2000], 80)).toBe(2000);
    expect(snap(1900, [2000], 80)).toBe(1900);
    // A playhead between grid lines still snaps onto the grid.
    expect(snap(1960, [1987], 80)).toBe(2000);
    expect(dragSpan({ startMs: 0, endMs: 1000 }, 'end', 960, 5000, [1987], 80).endMs).toBe(2000);
  });

  it('moves a bar keeping its length and clamps it to the scene', () => {
    const span = { startMs: 1000, endMs: 3000 };
    expect(dragSpan(span, 'move', 512, 5000)).toEqual({ startMs: 1500, endMs: 3500 });
    expect(dragSpan(span, 'move', 9000, 5000)).toEqual({ startMs: 3000, endMs: 5000 });
    expect(dragSpan(span, 'move', -9000, 5000)).toEqual({ startMs: 0, endMs: 2000 });
  });

  it('snaps the nearer edge of a moved bar', () => {
    expect(dragSpan({ startMs: 1000, endMs: 3000 }, 'move', 1940, 5000, [5000], 100)).toEqual({ startMs: 3000, endMs: 5000 });
  });

  it('trims either edge, never below the shortest length or outside the scene', () => {
    const span = { startMs: 1000, endMs: 3000 };
    expect(dragSpan(span, 'start', -400, 5000)).toEqual({ startMs: 600, endMs: 3000 });
    expect(dragSpan(span, 'start', 5000, 5000)).toEqual({ startMs: 3000 - MIN_LAYER_MS, endMs: 3000 });
    expect(dragSpan(span, 'end', 4000, 5000)).toEqual({ startMs: 1000, endMs: 5000 });
    expect(dragSpan(span, 'end', -5000, 5000)).toEqual({ startMs: 1000, endMs: 1000 + MIN_LAYER_MS });
  });

  it('writes a drag as a Change the validator accepts', () => {
    const span = dragSpan({ startMs: 400, endMs: 4800 }, 'start', 800, 5000, sceneTargets(r, 1, 's2-title'));
    const e = layerTiming(r, 1, 1, span)!;
    expect(e.summary).toBe('Title 0:06.2–0:09.8');
    const next = applyPatch(r, e.ops).doc;
    expect(next.scenes[1]!.layers[1]).toMatchObject({ startMs: 1200, endMs: 4800 });
    expect(validateRecipe(next)).toEqual([]);
    expect(layerTiming(r, 1, 1, { startMs: 400, endMs: 4800 })).toBeUndefined();
  });

  it('trims a scene and pulls its layers in with it', () => {
    const e = sceneTiming(r, 0, 3040)!;
    const next = applyPatch(r, e.ops).doc;
    expect(next.scenes[0]!.durationMs).toBe(3000);
    expect(next.scenes[0]!.layers.every((l) => l.endMs <= 3000)).toBe(true);
    expect(validateRecipe(next)).toEqual([]);
    expect(applyPatch(r, sceneTiming(r, 0, 999_999)!.ops).doc.scenes[0]!.durationMs).toBe(50_000);
  });

  it('puts layers of one name on one track, top first', () => {
    expect(tracks(r).map((t) => t.name)).toEqual(['Subtitle', 'Title', 'Rule', 'Card', 'Dot']);
    expect(tracks(r).find((t) => t.name === 'Title')!.bars).toHaveLength(3);
    expect(ticks(15000)).toEqual([0, 5000, 10000, 15000]);
  });
});
