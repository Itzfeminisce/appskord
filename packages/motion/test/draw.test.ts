import { describe, expect, it } from 'vitest';
import { chartLayers, CHART_DEFAULTS, PLOT, type Row } from '../src/charts';
import { chartPart, drawSpec, formatCount, growOutline, rigBones } from '../src/draw';
import { splitSharpJoins, strokeStrip } from '../src/paths';
import { autoRig, deformPoints, poseBones, rigLayers, RIG_DEFAULTS } from '../src/rigs';
import { bounds, roundedRect } from '../src/shapes';
import type { LayerV3 } from '../src/types';

const inks = { ink: '#fff', panel: '#222', accent: '#8B9CFF' };
const layer = (l: Partial<LayerV3> & Pick<LayerV3, 'id' | 'kind'>): LayerV3 => ({ depth: 'middle', tracks: {}, ...l });
const rows: Row[] = [
  { label: 'a', value: 10 },
  { label: 'b', value: 40 },
];

describe('drawSpec', () => {
  it('draws a shape at its content size, fill and stroke, and morphs and grows by its tracks', () => {
    const s = drawSpec(
      layer({ id: 'blob', kind: 'shape', tracks: { morph: [{ t: 0, v: 0 }], draw: [{ t: 0, v: 0 }] } }),
      [],
      { size: { w: 400, h: 100 }, color: '#f00', stroke: '#0f0', strokeWidth: 6 },
      inks,
    );
    if (s.kind !== 'shape') throw new Error(s.kind);
    expect(bounds(s.outline)).toMatchObject({ width: 400, height: 100 });
    expect(s).toMatchObject({ color: '#f00', stroke: { color: '#0f0', width: 6 }, grow: true });
    expect(bounds(s.morphTo!).width).toBeCloseTo(100, 0);
    const plain = drawSpec(layer({ id: 'p', kind: 'shape' }), [], undefined, inks);
    expect(plain).toMatchObject({ kind: 'shape', color: '#222', grow: false, morphTo: undefined });
  });

  it('draws a path from its SVG data with its stroke width', () => {
    const s = drawSpec(layer({ id: 'u', kind: 'path' }), [], { path: 'M 0 0 L 100 0 L 100 50', strokeWidth: 12 }, inks);
    expect(s).toMatchObject({ kind: 'path', width: 12, color: '#8B9CFF' });
    if (s.kind === 'path')
      expect(s.lines[0]).toEqual([
        [0, 0],
        [100, 0],
        [100, 50],
      ]);
  });

  it('draws text with its words, unit and size', () => {
    const s = drawSpec(
      layer({ id: 't', kind: 'text', type: { unit: 'word' } }),
      [],
      { text: 'Hi there', fontSize: 50 },
      inks,
    );
    expect(s).toEqual({ kind: 'text', text: 'Hi there', unit: 'word', fontSize: 50, color: '#fff', fill: false });
  });

  it('draws chart parts: bars on the baseline at plot height, a line through the dots, counters', () => {
    const bars = chartLayers({ id: 'c', depth: 'front' }, rows, { ...CHART_DEFAULTS, clone: false });
    const all = [layer({ id: 'c', kind: 'chart' }), ...bars];
    expect(drawSpec(all[0]!, all, undefined, inks).kind).toBe('none');
    const bar = drawSpec(
      all.find((l) => l.id === 'c~bar~1')!,
      all,
      undefined,
      inks,
    );
    if (bar.kind !== 'shape') throw new Error(bar.kind);
    const b = bounds(bar.outline);
    expect(b.y + b.height).toBeCloseTo(0);
    expect(b.height).toBeCloseTo(PLOT.height);
    expect(bar.grow).toBe(true);
    expect(
      drawSpec(
        all.find((l) => l.id === 'c~count~1')!,
        all,
        undefined,
        inks,
      ),
    ).toMatchObject({
      kind: 'count',
      count: { from: 0, to: 40 },
    });

    const line = chartLayers({ id: 'c', depth: 'front' }, rows, { ...CHART_DEFAULTS, show: 'line', clone: false });
    const spec = drawSpec(
      line.find((l) => l.id === 'c~line')!,
      line,
      undefined,
      inks,
    );
    if (spec.kind !== 'path') throw new Error(spec.kind);
    expect(spec.lines[0]).toHaveLength(2);
    expect(spec.lines[0]![1]![1]).toBeCloseTo(PLOT.baseline - PLOT.height);
    expect(
      drawSpec(
        line.find((l) => l.id === 'c~dot~0')!,
        line,
        undefined,
        inks,
      ).kind,
    ).toBe('shape');
  });

  it('hides bone layers and gives rigged hosts their bones', () => {
    const host = layer({ id: 'h', kind: 'shape' });
    const all = [host, ...rigLayers(host, autoRig({ w: 320, h: 200 }), { ...RIG_DEFAULTS, moves: { body: 'hop' } })];
    expect(drawSpec(all[1]!, all, undefined, inks).kind).toBe('none');
    expect(rigBones(host, all, { w: 320, h: 200 })).toHaveLength(4);
    expect(rigBones(host, [host], { w: 320, h: 200 })).toBeUndefined();
    expect(drawSpec(host, all, undefined, inks)).toMatchObject({ kind: 'shape', bones: expect.any(Array) });
  });
});

describe('pure geometry', () => {
  it('chartPart reads generated ids', () => {
    expect(chartPart('a~b~bar~3')).toEqual({ base: 'a~b', part: 'bar', i: 3 });
    expect(chartPart('c~line')).toEqual({ base: 'c', part: 'line', i: undefined });
    expect(chartPart('plain')).toBeUndefined();
  });

  it('formatCount counts by draw progress with decimals and grouping', () => {
    expect(formatCount({ from: 0, to: 2400 }, 0.5)).toBe('1,200');
    expect(formatCount({ from: 0, to: 2.5, decimals: 1 }, 2)).toBe('2.5');
    expect(formatCount({ from: -10, to: 0 }, 0)).toBe('-10');
  });

  it('growOutline squashes toward the bottom edge', () => {
    const g = growOutline(
      [
        [0, -100],
        [10, 0],
      ],
      0.25,
    );
    expect(g).toEqual([
      [0, -25],
      [10, 0],
    ]);
  });

  it('strokeStrip offsets a line by half its width', () => {
    const s = strokeStrip(
      [
        [0, 0],
        [10, 0],
      ],
      4,
    );
    expect([...s]).toEqual([0, 2, 0, -2, 10, 2, 10, -2]);
  });

  it('strokeStrip mitres radius-0 rect corners and joins across the seam', () => {
    const rect = roundedRect(100, 60, 0);
    const s = strokeStrip([...rect, rect[0]!], 10);
    // Every corner's outer edge sits a full half-width out on both sides: (50+5, 30+5) etc., no pinch at the seam.
    for (let i = 0; i < rect.length + 1; i++) {
      const [x, y] = rect[i % rect.length]!;
      const ex = Math.max(Math.abs(s[i * 4]! - x), Math.abs(s[i * 4 + 2]! - x));
      const ey = Math.max(Math.abs(s[i * 4 + 1]! - y), Math.abs(s[i * 4 + 3]! - y));
      expect(ex).toBeCloseTo(5, 6);
      expect(ey).toBeCloseTo(5, 6);
    }
    expect([s[0], s[1], s[2], s[3]]).toEqual([...s.slice(rect.length * 4, rect.length * 4 + 4)]);
  });

  it('strokeStrip ignores repeated points and bevels past the miter limit', () => {
    const dup = strokeStrip(
      [
        [0, 0],
        [10, 0],
        [10, 0],
        [20, 0],
      ],
      4,
    );
    expect([...dup.slice(4, 8)]).toEqual([10, 2, 10, -2]);
    const hairpin: [number, number][] = [
      [0, 0],
      [100, 0],
      [0, 1],
    ];
    const split = splitSharpJoins(hairpin);
    expect(split).toHaveLength(4);
    const s = strokeStrip(split, 4);
    for (let i = 0; i < split.length * 4; i++) expect(Math.abs(s[i]!)).toBeLessThan(103);
  });

  it('fits rig bones to the drawn outline, not the nominal size', () => {
    const host = layer({ id: 'h', kind: 'icon' });
    const all = [host, ...rigLayers(host, autoRig({ w: 120, h: 120 }), RIG_DEFAULTS)];
    const spec = drawSpec(host, all, { path: 'M 100 100 L 140 100 L 140 180 L 100 180 Z' }, inks);
    const body = spec.kind === 'shape' ? spec.bones!.find((b) => b.id === 'body')! : undefined;
    expect(body!.points[0]).toEqual([120, 180]);
    expect(body!.points[3]).toEqual([120, 100]);
  });

  it('deformPoints keeps an outline at rest and moves it with the bones', () => {
    const bones = autoRig({ w: 320, h: 200 });
    const rest = poseBones(bones, {});
    const outline: [number, number][] = [
      [-160, -100],
      [160, -100],
      [160, 100],
      [-160, 100],
    ];
    deformPoints(outline, rest, rest).forEach((p, i) => {
      expect(p[0]).toBeCloseTo(outline[i]![0]);
      expect(p[1]).toBeCloseTo(outline[i]![1]);
    });
    const hop = deformPoints(outline, rest, poseBones(bones, { body: { rotate: 0, y: -50, scale: 1 } }));
    for (const [i, p] of hop.entries()) expect(p[1]).toBeCloseTo(outline[i]![1] - 50);
    const lean = deformPoints(outline, rest, poseBones(bones, { body: { rotate: 20, y: 0, scale: 1 } }));
    expect(lean[0]![0]).not.toBeCloseTo(outline[0]![0]);
  });
});
