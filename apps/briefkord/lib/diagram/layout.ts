/** Layered layout for diagrams whose nodes have no places yet, such as the ones AI makes: wraps to fit, branches on their own lanes. */
import type { Diagram, DiagramEdge, DiagramNode } from '../board/types';
import { routeEdge, routeSegments, type Box, type Segment } from './route';
import { EDGE_FONT, fitSize, LABEL_FONT, measureText } from './size';

export { fitSize } from './size';

export type UnplacedNode = Omit<DiagramNode, 'x' | 'y' | 'w' | 'h'> & Partial<Pick<DiagramNode, 'x' | 'y' | 'w' | 'h'>>;
export interface UnplacedDiagram { nodes: UnplacedNode[]; edges: DiagramEdge[] }

/** The least space between columns and rows; it grows with the shapes on either side. */
export const LAYOUT_GAP = { x: 40, y: 36 };
/** The AI preview's 580 x 364 drawing area in diagram units; a layout that fits it reads at 12 px there. */
export const LAYOUT_ROOM = { w: Math.round((580 * LABEL_FONT) / 12), h: Math.round((364 * LABEL_FONT) / 12) };

const placed = (n: UnplacedNode): n is DiagramNode => [n.x, n.y, n.w, n.h].every((v) => typeof v === 'number' && Number.isFinite(v));

/** True when some node has no place, or every node sits on the same spot. */
export function needsLayout(diagram: UnplacedDiagram): boolean {
  if (!diagram.nodes.every(placed)) return true;
  const spots = new Set((diagram.nodes as DiagramNode[]).map((n) => `${n.x},${n.y}`));
  return diagram.nodes.length > 1 && spots.size === 1;
}

/** Space between two columns or rows whose largest shapes measure `a` and `b`, wide enough for an arrow label. */
export function layoutGap(min: number, a: number, b: number, label = 0): number {
  return Math.round(Math.max(min + 0.15 * Math.max(a, b), label + 28));
}

/** Edges that do not close a loop, found depth first in node order; loops would make layers endless. */
function forwardEdges(ids: string[], edges: DiagramEdge[]): DiagramEdge[] {
  const out = new Map<string, DiagramEdge[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (e.from !== e.to && out.has(e.from) && out.has(e.to)) out.get(e.from)!.push(e);
  const state = new Map<string, 'open' | 'done'>();
  const keep: DiagramEdge[] = [];
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const e of out.get(id)!) {
      const s = state.get(e.to);
      if (s === 'open') continue;
      keep.push(e);
      if (!s) visit(e.to);
    }
    state.set(id, 'done');
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  return keep;
}

type Dir = 'LR' | 'RL' | 'TB' | 'BT';
const across = (d: Dir) => d === 'LR' || d === 'RL';
const STEP: Record<Dir, Cell> = { LR: { c: 1, r: 0 }, RL: { c: -1, r: 0 }, TB: { c: 0, r: 1 }, BT: { c: 0, r: -1 } };
interface Cell { c: number; r: number }

/** Lane choices for one layer: which side of the main line each item goes. */
function slotOptions(n: number): number[][] {
  if (n === 1) return [[0]];
  const three = [0, 1, -1];
  const perms = (pool: number[], k: number): number[][] =>
    k === 0 ? [[]] : pool.flatMap((v) => perms(pool.filter((p) => p !== v), k - 1).map((rest) => [v, ...rest]));
  if (n <= 3) return perms(three, n);
  const line = Array.from({ length: n }, (_, i) => i);
  return [line, [...line].reverse()];
}

/** Where each layer goes: its direction, and whether it starts a new band (wraps). */
type Band = { dir: Dir; wrap: boolean }[];

/** Band patterns to try: one line, or wrapped every `k` layers, turning the same way, alternating, or snaking back. */
function bandPatterns(layers: number): Band[] {
  const of = (k: number, pick: (b: number) => Dir): Band => Array.from({ length: layers }, (_, i) => ({ dir: pick(Math.floor(i / k)), wrap: i > 0 && i % k === 0 }));
  const out: Band[] = [of(layers, () => 'LR'), of(layers, () => 'TB')];
  for (let k = Math.max(2, Math.ceil(layers / 4)); k < layers; k++) {
    out.push(of(k, () => 'LR'), of(k, () => 'TB'), of(k, (b) => (b % 2 ? 'TB' : 'LR')), of(k, (b) => (b % 2 ? 'LR' : 'TB')));
  }
  // A long flow snakes back and forth so it keeps a readable shape.
  for (let k = Math.max(3, Math.ceil(layers / 6)); k <= Math.ceil(layers / 2) && k < layers; k++) out.push(of(k, (b) => (b % 2 ? 'RL' : 'LR')), of(k, (b) => (b % 2 ? 'BT' : 'TB')));
  return out;
}

const segHits = (s: Segment, b: Box, inset: number) => {
  const x0 = Math.min(s.x1, s.x2), x1 = Math.max(s.x1, s.x2), y0 = Math.min(s.y1, s.y2), y1 = Math.max(s.y1, s.y2);
  return x0 < b.x + b.w - inset && x1 > b.x + inset && y0 < b.y + b.h - inset && y1 > b.y + inset;
};

const boxesMeet = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function collinear(a: Segment, b: Segment): number {
  const av = a.x1 === a.x2, bv = b.x1 === b.x2;
  if (av !== bv) return 0;
  if (av ? Math.abs(a.x1 - b.x1) > 1 : Math.abs(a.y1 - b.y1) > 1) return 0;
  const [a0, a1] = av ? [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)] : [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)];
  const [b0, b1] = av ? [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)] : [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)];
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function crosses(a: Segment, b: Segment): boolean {
  const av = a.x1 === a.x2, bv = b.x1 === b.x2;
  if (av === bv) return false;
  const [v, h] = av ? [a, b] : [b, a];
  const inside = (p: number, q0: number, q1: number) => p > Math.min(q0, q1) + 1 && p < Math.max(q0, q1) - 1;
  return inside(v.x1, h.x1, h.x2) && inside(h.y1, v.y1, v.y2);
}

/** How bad a placed diagram reads: lines through nodes, hidden labels, shared lines, crossings and a small preview. */
export function layoutCost(nodes: DiagramNode[], edges: DiagramEdge[], room = LAYOUT_ROOM): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const routes = edges
    .filter((e) => e.from !== e.to && byId.has(e.from) && byId.has(e.to))
    .map((e) => ({ e, route: routeEdge(byId.get(e.from)!, byId.get(e.to)!) }))
    .map(({ e, route }) => ({ e, route, segs: routeSegments(route.d) }));
  let cost = 0;
  for (const { e, route, segs } of routes) {
    for (const n of nodes) if (n.id !== e.from && n.id !== e.to && segs.some((s) => segHits(s, n, 2))) cost += 100;
    if (e.label && route.label) {
      const w = measureText(e.label, EDGE_FONT) + 4;
      const box = { x: route.label.anchor === 'middle' ? route.label.x - w / 2 : route.label.x, y: route.label.y - EDGE_FONT, w, h: EDGE_FONT + 2 };
      if (nodes.some((n) => boxesMeet(box, n))) cost += 30;
      for (const other of routes) if (other.e !== e && other.segs.some((s) => segHits(s, box, 0))) cost += 30;
    }
  }
  routes.forEach((a, i) => routes.slice(i + 1).forEach((b) => {
    const shared = a.e.from === b.e.from || a.e.to === b.e.to;
    for (const s of a.segs) for (const t of b.segs) {
      if (!shared && collinear(s, t) > 4) cost += 40;
      if (crosses(s, t)) cost += 2;
    }
  }));
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const w = Math.max(...nodes.map((n) => n.x + n.w)) - minX + 32, h = Math.max(...nodes.map((n) => n.y + n.h)) - minY + 32;
  return cost + (1 - Math.min(1, room.w / w, room.h / h)) * 200;
}

/** Places every node: a node's layer is its longest path from a start; layers run in bands that wrap to fit `room`. */
export function layoutDiagram(diagram: UnplacedDiagram, origin = { x: 0, y: 0 }, room = LAYOUT_ROOM): Diagram {
  if (diagram.nodes.length === 0) return { nodes: [], edges: [] };
  const ids = diagram.nodes.map((n) => n.id);
  const known = new Set(ids);
  const edges = diagram.edges.filter((e) => known.has(e.from) && known.has(e.to));
  const forward = forwardEdges(ids, edges);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of forward) preds.get(e.to)!.push(e.from);

  const layer = new Map<string, number>();
  const layerOf = (id: string): number => {
    const seen = layer.get(id);
    if (seen !== undefined) return seen;
    layer.set(id, 0);
    const value = Math.max(0, ...preds.get(id)!.map((p) => layerOf(p) + 1));
    layer.set(id, value);
    return value;
  };
  ids.forEach(layerOf);

  // A line that skips layers keeps a free lane through each one it passes.
  const itemPreds = new Map<string, string[]>(ids.map((id) => [id, []]));
  const itemLayer = new Map(layer);
  for (const e of forward) {
    let from = e.from;
    for (let l = layer.get(e.from)! + 1; l < layer.get(e.to)!; l++) {
      const pass = `\u0000${e.id}:${l}`;
      itemLayer.set(pass, l);
      itemPreds.set(pass, [from]);
      from = pass;
    }
    itemPreds.get(e.to)!.push(from);
  }
  const count = Math.max(0, ...itemLayer.values()) + 1;
  const layers: string[][] = Array.from({ length: count }, () => []);
  for (const [id, l] of itemLayer) layers[l]!.push(id);
  const rank = new Map<string, number>();
  for (const items of layers) {
    const wish = (id: string) => {
      const p = itemPreds.get(id)!.map((q) => rank.get(q)!);
      return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0;
    };
    const order = items.map((id, i) => ({ id, i, w: wish(id), pass: id.startsWith('\u0000') ? 0 : 1 })).sort((a, b) => a.w - b.w || a.pass - b.pass || a.i - b.i);
    items.splice(0, items.length, ...order.map((o) => o.id));
    items.forEach((id, r) => rank.set(id, r));
  }

  const size = new Map(diagram.nodes.map((n) => {
    const fit = fitSize(n.kind, n.label);
    return [n.id, { w: Math.max(n.w ?? 0, fit.w), h: Math.max(n.h ?? 0, fit.h) }];
  }));
  const labelRoom = Math.max(0, ...edges.map((e) => (e.label ? measureText(e.label, EDGE_FONT) : 0)));

  let options = layers.map((items) => slotOptions(items.length));
  if (options.reduce((a, o) => a * o.length, 1) > 216) options = layers.map((items) => slotOptions(items.length).slice(0, 1));
  const slotSets: number[][][] = options.reduce<number[][][]>((acc, o) => acc.flatMap((pre) => o.map((s) => [...pre, s])), [[]]);

  const place = (band: Band, slots: number[][]): DiagramNode[] | undefined => {
    const cells = new Map<string, Cell>();
    const taken = new Set<string>();
    let axis: Cell = { c: 0, r: 0 };
    let maxC = 0, maxR = 0;
    for (let l = 0; l < count; l++) {
      const { dir, wrap } = band[l]!;
      let end = l + 1;
      while (end < count && !band[end]!.wrap) end++;
      // Lanes on the near side of any layer in the band, so a new band keeps clear of the last one's lanes.
      const minSlot = Math.min(...slots.slice(l, end).flat());
      // A new band starts past everything placed so far, beside the last layer.
      if (wrap && across(band[l - 1]!.dir)) axis = { c: axis.c, r: maxR + 1 - (across(dir) ? minSlot : 0) };
      else if (wrap) axis = { c: maxC + 1 - (across(dir) ? 0 : minSlot), r: axis.r };
      else if (l > 0) axis = { c: axis.c + STEP[dir].c, r: axis.r + STEP[dir].r };
      for (const [i, id] of layers[l]!.entries()) {
        const s = slots[l]![i]!;
        const cell = across(dir) ? { c: axis.c, r: axis.r + s } : { c: axis.c + s, r: axis.r };
        const key = `${cell.c},${cell.r}`;
        if (taken.has(key)) return undefined;
        taken.add(key);
        cells.set(id, cell);
      }
      for (const id of layers[l]!) {
        maxC = Math.max(maxC, cells.get(id)!.c);
        maxR = Math.max(maxR, cells.get(id)!.r);
      }
    }
    const all = [...cells.values()];
    const c0 = Math.min(...all.map((c) => c.c)), r0 = Math.min(...all.map((c) => c.r));
    const cols = Math.max(...all.map((c) => c.c)) - c0 + 1, rows = Math.max(...all.map((c) => c.r)) - r0 + 1;
    const colW = Array<number>(cols).fill(0), rowH = Array<number>(rows).fill(0);
    for (const id of ids) {
      const { c, r } = cells.get(id)!;
      colW[c - c0] = Math.max(colW[c - c0]!, size.get(id)!.w);
      rowH[r - r0] = Math.max(rowH[r - r0]!, size.get(id)!.h);
    }
    const colX = [origin.x], rowY = [origin.y];
    for (let c = 1; c < cols; c++) colX.push(colX[c - 1]! + colW[c - 1]! + layoutGap(LAYOUT_GAP.x, colW[c - 1]!, colW[c]!, labelRoom));
    for (let r = 1; r < rows; r++) rowY.push(rowY[r - 1]! + rowH[r - 1]! + layoutGap(LAYOUT_GAP.y, rowH[r - 1]!, rowH[r]!, EDGE_FONT));
    return diagram.nodes.map((n): DiagramNode => {
      const { w, h } = size.get(n.id)!;
      const { c, r } = cells.get(n.id)!;
      return { ...n, w, h, x: Math.round(colX[c - c0]! + (colW[c - c0]! - w) / 2), y: Math.round(rowY[r - r0]! + (rowH[r - r0]! - h) / 2) };
    });
  };

  let best: { nodes: DiagramNode[]; cost: number } | undefined;
  for (const band of bandPatterns(count)) {
    const wraps = band.filter((b) => b.wrap).length;
    for (const slots of slotSets) {
      const nodes = place(band, slots);
      if (!nodes) continue;
      const spread = slots.flat().reduce((a, s) => a + Math.abs(s), 0);
      const cost = layoutCost(nodes, edges, room) + wraps * 2 + spread * 0.1 + (band[0]!.dir === 'TB' ? 0.5 : 0);
      if (!best || cost < best.cost - 1e-9) best = { nodes, cost };
    }
  }
  return { nodes: best?.nodes ?? [], edges };
}
