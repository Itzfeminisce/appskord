// Data scenes: a pasted table turned into v3 recipe layers (bars, line, dots or a counter grid) with fixed tracks.
// Pure: the layers depend only on the rows and the options, so a frame at t depends only on the recipe and t.
import type { Key, LayerV3, Track } from './types';

export interface Row {
  label: string;
  value: number;
}
export type ChartShape = 'bars' | 'line' | 'dots' | 'grid';
export const CHART_SHAPES: readonly [ChartShape, string][] = [
  ['bars', 'Bars'],
  ['line', 'Line'],
  ['dots', 'Dots'],
  ['grid', 'Counter grid'],
];
export interface ChartOptions {
  show: ChartShape;
  /** "Clone each row": each row becomes its own animated card. */
  clone: boolean;
  countUp: boolean;
  staggerMs: number;
}
export const CHART_DEFAULTS: Readonly<ChartOptions> = { show: 'bars', clone: true, countUp: true, staggerMs: 60 };

export interface ParsedTable {
  rows: Row[];
  /** 1-based line numbers that had no number to chart. */
  skipped: number[];
}

/** Most rows and columns a chart table keeps; the rest is dropped. */
export const MAX_ROWS = 200;
export const MAX_COLS = 12;
/** Most records read from a paste, so a huge file cannot stall the parse. */
const MAX_RECORDS = 5000;

/** Separator for the text: tabs win, then semicolons, then commas, counted outside quotes over the first 5 lines. */
function detectSeparator(text: string): string {
  const counts = { '\t': 0, ';': 0, ',': 0 };
  let quoted = false;
  let lines = 0;
  let blank = true;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const c = text[i]!;
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === '\n' || c === '\r') {
      if (!blank) lines++;
      blank = true;
      continue;
    } else if (c in counts) counts[c as keyof typeof counts]++;
    if (c.trim()) blank = false;
  }
  return counts['\t'] ? '\t' : counts[';'] ? ';' : ',';
}

/** The whole text in one pass: quotes may wrap a field (newlines and separators inside), "" inside quotes is a quote. */
function records(text: string, sep: string): { n: number; cells: string[] }[] {
  const out: { n: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let first = 1;
  const end = () => {
    cells.push(cell.trim());
    if (cells.length > 1 || cells[0] !== '') out.push({ n: first, cells: cells.slice(0, MAX_COLS) });
    cells = [];
    cell = '';
    first = line;
  };
  for (let i = 0; i < text.length && out.length < MAX_RECORDS; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
        cell += c;
      }
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === sep) {
      cells.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      line++;
      end();
    } else cell += c;
  }
  if (out.length < MAX_RECORDS) end();
  return out;
}

/** "1,050", "$3.50", "12%", "(40)" → numbers; anything else is undefined. */
export function parseNumber(text: string): number | undefined {
  let s = text.trim().replace(/[\s $€£¥%]/g, '');
  const negative = /^\(.*\)$/.test(s);
  if (negative) s = s.slice(1, -1);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? (negative ? -n : n) : undefined;
}

/**
 * A table pasted from a spreadsheet or a CSV/TSV file: tabs win, then semicolons, then commas. The first column is
 * the label and the first numeric column after it the value; a first row without a number is a header.
 */
export function parseTable(text: string): ParsedTable {
  const clean = text.replace(/^\uFEFF/, '');
  const table = records(clean, detectSeparator(clean));
  const valueCol = (cells: string[]) => cells.findIndex((c, i) => i > 0 && parseNumber(c) !== undefined);
  // A one-column table is a list of numbers.
  const single = table.every((r) => r.cells.length === 1);
  const rows: Row[] = [];
  const skipped: number[] = [];
  table.forEach((r, i) => {
    const col = single ? 0 : valueCol(r.cells);
    const value = col < 0 ? undefined : parseNumber(r.cells[col]!);
    if (value === undefined) {
      if (i > 0 || rows.length) skipped.push(r.n);
      return;
    }
    if (rows.length < MAX_ROWS) rows.push({ label: single ? `Row ${rows.length + 1}` : r.cells[0]!, value });
  });
  return { rows, skipped };
}

/** Tab-separated text, the way a spreadsheet copies it. */
export const tableText = (rows: readonly Row[]): string => rows.map((r) => `${r.label}\t${r.value}`).join('\n');

// Recipe px in a 1080-wide frame centred on 0,0, y down.
export const PLOT = { left: -380, width: 760, baseline: 260, height: 440 } as const;
export const GROW_MS = 700;
const FADE_MS = 120;
const POP_MS = 300;
const CARD = { x: 300, y: -220, step: 18, rise: 40, ms: 500 } as const;
const CELL = { w: 240, h: 150 } as const;

const key = (t: number, v: number): Key<number> => ({ t, v });
const hold = (v: number): Track<number> => [key(0, v)];
const ramp = (a: number, b: number, ms: number): Track<number> => (a === b ? hold(b) : [key(0, a), key(ms, b)]);
const decimalsOf = (rows: readonly Row[]) =>
  Math.min(
    6,
    rows.reduce((m, r) => Math.max(m, (String(r.value).split('.')[1] ?? '').length), 0),
  );

/** Each row's share of the tallest bar, 0..1 (negative rows draw nothing). */
export function heights(rows: readonly Row[]): number[] {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return rows.map((r) => (max > 0 ? Math.max(0, r.value) / max : 0));
}

/** The centre x of each row's column. */
export const columns = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => PLOT.left + (PLOT.width / Math.max(1, n)) * (i + 0.5));

/** Generated layer ids: `<chart layer id>~<part>~<row>`. */
export const chartPartId = (base: string, part: 'bar' | 'count' | 'dot' | 'cell' | 'card' | 'line', i?: number) =>
  i === undefined ? `${base}~${part}` : `${base}~${part}~${i}`;
const isPart = (base: string, id: string) => id.startsWith(`${base}~`);

/** The stagger scaled down so the last row finishes growing inside `room` ms of scene. */
const fitStagger = (staggerMs: number, n: number, room: number): number => {
  const s = Math.max(0, staggerMs);
  return n > 1 ? Math.floor(Math.max(0, Math.min(s, (room - GROW_MS) / (n - 1)))) : s;
};

/**
 * The layers that draw `rows` for the chart layer `base`. On a bar the `draw` track is its height as a share of the
 * plot; on a count it is the count's progress. Every row starts `staggerMs` after the one before.
 */
export function chartLayers(
  base: Pick<LayerV3, 'id' | 'depth'>,
  rows: readonly Row[],
  o: ChartOptions,
  start = 0,
  sceneMs?: number,
): LayerV3[] {
  const n = rows.length;
  const stagger = fitStagger(o.staggerMs, n, sceneMs === undefined ? Infinity : sceneMs - start);
  const xs = columns(n);
  const hs = heights(rows);
  const decimals = decimalsOf(rows);
  const at = (i: number) => start + i * stagger;
  const count = (r: Row) => (o.countUp ? { from: 0, to: r.value, decimals } : { from: r.value, to: r.value, decimals });
  const out: LayerV3[] = [];
  const top = (i: number) => PLOT.baseline - hs[i]! * PLOT.height;
  if (o.show === 'grid') {
    const cols = Math.ceil(Math.sqrt(n));
    const lines = Math.ceil(n / Math.max(1, cols));
    rows.forEach((r, i) => {
      const x = (i % cols) * CELL.w - ((cols - 1) * CELL.w) / 2;
      const y = Math.floor(i / cols) * CELL.h - ((lines - 1) * CELL.h) / 2;
      out.push({
        id: chartPartId(base.id, 'cell', i),
        kind: 'text',
        depth: base.depth,
        start: at(i),
        count: count(r),
        tracks: {
          x: hold(x),
          y: ramp(y + 24, y, POP_MS),
          opacity: ramp(0, 1, FADE_MS),
          draw: ramp(o.countUp ? 0 : 1, 1, GROW_MS),
        },
      });
    });
  } else if (o.show === 'line') {
    const lineMs = GROW_MS + Math.max(0, n - 1) * stagger;
    out.push({
      id: chartPartId(base.id, 'line'),
      kind: 'path',
      depth: base.depth,
      start,
      tracks: { draw: ramp(0, 1, lineMs), opacity: ramp(0, 1, FADE_MS) },
    });
    rows.forEach((_, i) => {
      // Each point pops as the line reaches it.
      const reach = n > 1 ? Math.round((lineMs * i) / (n - 1)) : 0;
      out.push({
        id: chartPartId(base.id, 'dot', i),
        kind: 'shape',
        depth: base.depth,
        start: start + reach,
        tracks: { x: hold(xs[i]!), y: hold(top(i)), scale: ramp(0, 1, POP_MS) },
      });
    });
  } else {
    rows.forEach((_, i) => {
      out.push(
        o.show === 'bars'
          ? {
              id: chartPartId(base.id, 'bar', i),
              kind: 'shape',
              depth: base.depth,
              start: at(i),
              tracks: {
                x: hold(xs[i]!),
                y: hold(PLOT.baseline),
                draw: ramp(0, hs[i]!, GROW_MS),
                opacity: ramp(0, 1, FADE_MS),
              },
            }
          : {
              id: chartPartId(base.id, 'dot', i),
              kind: 'shape',
              depth: base.depth,
              start: at(i),
              tracks: { x: hold(xs[i]!), y: ramp(PLOT.baseline, top(i), GROW_MS), scale: ramp(0, 1, POP_MS) },
            },
      );
    });
  }
  if (o.show !== 'grid')
    rows.forEach((r, i) => {
      // The value rides the top of its bar or dot.
      const lineStart = out.find((l) => l.id === chartPartId(base.id, 'dot', i))?.start;
      out.push({
        id: chartPartId(base.id, 'count', i),
        kind: 'text',
        depth: base.depth,
        start: o.show === 'line' ? (lineStart ?? at(i)) : at(i),
        count: count(r),
        tracks: {
          x: hold(xs[i]!),
          y: o.show === 'line' ? hold(top(i) - 40) : ramp(PLOT.baseline - 40, top(i) - 40, GROW_MS),
          opacity: ramp(0, 1, FADE_MS),
          draw: ramp(o.countUp ? 0 : 1, 1, GROW_MS),
        },
      });
    });
  if (o.clone)
    rows.forEach((_, i) => {
      const y = CARD.y + i * CARD.step;
      out.push({
        id: chartPartId(base.id, 'card', i),
        kind: 'shape',
        depth: 'back',
        start: at(i),
        tracks: { x: hold(CARD.x + i * CARD.step), y: ramp(y + CARD.rise, y, CARD.ms), opacity: ramp(0, 1, CARD.ms) },
      });
    });
  return out;
}

/** The options a chart's layers were made with; undefined when `base` has none yet. */
export function chartOptionsOf(base: string, layers: readonly LayerV3[]): ChartOptions | undefined {
  const parts = layers.filter((l) => isPart(base, l.id));
  if (!parts.length) return undefined;
  const has = (part: string) => parts.some((l) => l.id.startsWith(`${base}~${part}`));
  const show: ChartShape = has('cell') ? 'grid' : has('line') ? 'line' : has('dot') ? 'dots' : 'bars';
  const counts = parts.filter((l) => l.count);
  const countUp = counts.length ? counts.some((l) => (l.tracks.draw?.length ?? 0) > 1) : CHART_DEFAULTS.countUp;
  const series = show === 'grid' ? 'cell' : show === 'bars' ? 'bar' : 'dot';
  const a = parts.find((l) => l.id === chartPartId(base, series, 0))?.start;
  const b = parts.find((l) => l.id === chartPartId(base, series, 1))?.start;
  let staggerMs = a !== undefined && b !== undefined ? b - a : CHART_DEFAULTS.staggerMs;
  if (show === 'line' && a !== undefined && b !== undefined) {
    // A line's points sit at even shares of its draw, which runs GROW_MS plus the stagger per point.
    const n = parts.filter((l) => l.id.startsWith(`${base}~dot~`)).length;
    staggerMs = Math.max(0, Math.round(((b - a) * (n - 1) - GROW_MS) / (n - 1)));
  }
  return { show, clone: has('card'), countUp, staggerMs };
}

/** The scene's layers with `base`'s chart redrawn from `rows`: old parts out, new parts right after the base layer. */
export function withChart(
  layers: readonly LayerV3[],
  baseId: string,
  rows: readonly Row[],
  o: ChartOptions,
  start = 0,
  sceneMs?: number,
): LayerV3[] {
  const base = layers.find((l) => l.id === baseId);
  if (!base) return [...layers];
  const kept = layers.filter((l) => !isPart(baseId, l.id));
  const i = kept.indexOf(base);
  return [...kept.slice(0, i + 1), ...chartLayers(base, rows, o, start, sceneMs), ...kept.slice(i + 1)];
}

/** "60 ms" → 60; undefined when it is not a whole, non-negative number of ms. */
export function parseStagger(text: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(text);
  if (!m) return undefined;
  const ms = Number(m[1]) * (m[2]?.toLowerCase() === 's' ? 1000 : 1);
  return ms <= 5000 ? Math.round(ms) : undefined;
}
