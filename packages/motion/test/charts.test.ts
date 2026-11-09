import { describe, expect, it } from 'vitest';
import {
  chartLayers,
  chartOptionsOf,
  CHART_DEFAULTS,
  heights,
  parseNumber,
  parseStagger,
  parseTable,
  PLOT,
  tableText,
  withChart,
  type ChartOptions,
} from '../src/charts';
import { validateScene } from '../src/recipe';
import { frameAt } from '../src/scene';
import type { LayerV3, SceneV3 } from '../src/types';

const WEEK = [
  { label: 'Mon', value: 120 },
  { label: 'Tue', value: 180 },
  { label: 'Wed', value: 240 },
  { label: 'Thu', value: 210 },
  { label: 'Fri', value: 300 },
];
const base: LayerV3 = { id: 'bars', kind: 'chart', depth: 'middle', slotId: 'bars', start: 300, tracks: {} };
const scene = (layers: LayerV3[]): SceneV3 => ({
  version: 3,
  id: 's3',
  templateId: 'chart',
  ms: 3500,
  layers,
  camera: { move: 'hold', amount: 0 },
  transition: { kind: 'cut' },
});

describe('table parsing', () => {
  it('reads tab-separated rows copied from a spreadsheet, skipping the header', () => {
    expect(parseTable('Day\tCups\nMon\t120\nTue\t180\n')).toEqual({ rows: WEEK.slice(0, 2), skipped: [] });
  });

  it('reads CSV with quotes, thousands separators and a CRLF file', () => {
    const csv = 'Day,Cups,Note\r\n"Mon, early","1,050",x\r\nTue,180,\r\n"He said ""hi""",3.5,\r\n';
    expect(parseTable(csv).rows).toEqual([
      { label: 'Mon, early', value: 1050 },
      { label: 'Tue', value: 180 },
      { label: 'He said "hi"', value: 3.5 },
    ]);
  });

  it('takes the first numeric column, semicolons, and reports rows without a number', () => {
    const out = parseTable('Shop;City;Sales\nA;Leeds;12%\nB;York;n/a\nC;Hull;$7.25');
    expect(out.rows).toEqual([
      { label: 'A', value: 12 },
      { label: 'C', value: 7.25 },
    ]);
    expect(out.skipped).toEqual([3]);
  });

  it('turns a single column of numbers into numbered rows', () => {
    expect(parseTable('Cups\n4\n5').rows).toEqual([
      { label: 'Row 1', value: 4 },
      { label: 'Row 2', value: 5 },
    ]);
  });

  it('parses numbers the way spreadsheets write them', () => {
    expect(parseNumber('(40)')).toBe(-40);
    expect(parseNumber('€1,234.5')).toBe(1234.5);
    expect(parseNumber('1,05')).toBeUndefined();
    expect(parseNumber('Mon')).toBeUndefined();
    expect(parseTable(tableText(WEEK)).rows).toEqual(WEEK);
    expect(parseStagger('60 ms')).toBe(60);
    expect(parseStagger('0.1 s')).toBe(100);
    expect(parseStagger('fast')).toBeUndefined();
  });
});

describe('chart tracks', () => {
  const opts = (o: Partial<ChartOptions> = {}): ChartOptions => ({ ...CHART_DEFAULTS, ...o });

  it('grows each bar to its share of the tallest, 60 ms apart, with a count riding its top', () => {
    const layers = chartLayers(base, WEEK, opts({ clone: false }), 300);
    const bars = layers.filter((l) => l.id.startsWith('bars~bar~'));
    expect(bars.map((l) => l.start)).toEqual([300, 360, 420, 480, 540]);
    expect(bars.map((l) => l.tracks.draw!.at(-1)!.v)).toEqual(heights(WEEK));
    expect(heights(WEEK)[4]).toBe(1);
    const counts = layers.filter((l) => l.count);
    expect(counts.map((l) => l.count)).toEqual(WEEK.map((r) => ({ from: 0, to: r.value, decimals: 0 })));
    expect(counts[4]!.tracks.y!.at(-1)!.v).toBe(PLOT.baseline - PLOT.height - 40);
    expect(validateScene(scene([base, ...layers])).ok).toBe(true);
  });

  it('draws a line whose points pop as it reaches them, and dots that rise to their values', () => {
    const line = chartLayers(base, WEEK, opts({ show: 'line', clone: false }));
    expect(line[0]!.id).toBe('bars~line');
    expect(line[0]!.tracks.draw).toEqual([
      { t: 0, v: 0 },
      { t: 940, v: 1 },
    ]);
    expect(line.filter((l) => l.id.includes('~dot~')).map((l) => l.start)).toEqual([0, 235, 470, 705, 940]);
    const dots = chartLayers(base, WEEK, opts({ show: 'dots', clone: false }));
    expect(dots.find((l) => l.id === 'bars~dot~2')!.tracks.y).toEqual([
      { t: 0, v: PLOT.baseline },
      { t: 700, v: PLOT.baseline - 0.8 * PLOT.height },
    ]);
  });

  it('lays a counter grid out in rows of cells, and holds the values when Count up is off', () => {
    const grid = chartLayers(base, WEEK, opts({ show: 'grid', countUp: false, clone: false }));
    expect(grid).toHaveLength(5);
    expect(grid.map((l) => l.kind)).toEqual(Array(5).fill('text'));
    expect(grid[0]!.count).toEqual({ from: 120, to: 120, decimals: 0 });
    expect(grid.map((l) => [l.tracks.x![0]!.v, l.tracks.y!.at(-1)!.v])).toEqual([
      [-240, -75],
      [0, -75],
      [240, -75],
      [-240, 75],
      [0, 75],
    ]);
  });

  it('clones each row into its own card on the back layer', () => {
    const cards = chartLayers(base, WEEK, opts()).filter((l) => l.id.includes('~card~'));
    expect(cards).toHaveLength(5);
    expect(cards.every((l) => l.depth === 'back')).toBe(true);
    expect(cards.map((l) => l.start)).toEqual([0, 60, 120, 180, 240]);
  });

  it('is deterministic and reads back the options it was made with', () => {
    for (const o of [
      opts(),
      opts({ show: 'line', staggerMs: 90 }),
      opts({ show: 'dots', countUp: false }),
      opts({ show: 'grid', clone: false, staggerMs: 0 }),
    ]) {
      const layers = withChart([base, { id: 'note', kind: 'text', depth: 'front', tracks: {} }], 'bars', WEEK, o, 300);
      expect(layers[0]!.id).toBe('bars');
      expect(layers.at(-1)!.id).toBe('note');
      expect(chartOptionsOf('bars', layers)).toEqual(o);
      expect(withChart(layers, 'bars', WEEK, o, 300)).toEqual(layers);
      const s = scene(layers);
      expect(validateScene(s).ok).toBe(true);
      expect(frameAt(s, 812)).toEqual(frameAt(structuredClone(s), 812));
    }
    expect(chartOptionsOf('bars', [base])).toBeUndefined();
  });

  it('frames a growing bar from its tracks alone', () => {
    const s = scene([base, ...chartLayers(base, WEEK, opts({ clone: false }), 0)]);
    const at = (t: number) => frameAt(s, t).layers.find((l) => l.id === 'bars~bar~4')!.props.draw;
    expect(at(240)).toBe(0);
    expect(at(240 + 700)).toBe(1);
    expect(at(240 + 350)).toBeGreaterThan(0);
    expect(at(240 + 350)).toBeLessThan(1);
  });
});
