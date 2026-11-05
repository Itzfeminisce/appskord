/** Layered layout for diagrams whose nodes have no places yet, such as the ones AI makes: wraps to fit, branches on their own lanes. */
import type { Diagram, DiagramEdge, DiagramNode } from '../board/types';
import { routeEdgeSegments, type Box, type Segment } from './route';
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  return lineCost(nodes, links(nodes.map((n) => n.id), edges), roomCost(minX, minY, maxX, maxY, room), Infinity);
}

/** How much a layout spanning these bounds is shrunk to fit `room`, as cost. */
const roomCost = (minX: number, minY: number, maxX: number, maxY: number, room: { w: number; h: number }) =>
  (1 - Math.min(1, room.w / (maxX - minX + 32), room.h / (maxY - minY + 32))) * 200;

/** An edge by node index, with its label's width; worked out once so each candidate layout only routes. */
interface Link { from: number; to: number; labelW?: number }

function links(ids: string[], edges: DiagramEdge[]): Link[] {
  const at = new Map<string, number>();
  ids.forEach((id, i) => { if (!at.has(id)) at.set(id, i); });
  return edges.flatMap((e): Link[] => {
    const from = at.get(e.from), to = at.get(e.to);
    if (e.from === e.to || from === undefined || to === undefined) return [];
    return [{ from, to, labelW: e.label ? measureText(e.label, EDGE_FONT) + 4 : undefined }];
  });
}

/** `cost` plus the cost of the lines between `boxes`, or Infinity as soon as it passes `limit`. */
function lineCost(boxes: Box[], links: Link[], cost: number, limit: number): number {
  if (cost > limit) return Infinity;
  const routes = links.map(({ from, to, labelW: w }) => {
    const { segs, label } = routeEdgeSegments(boxes[from]!, boxes[to]!);
    const box = w === undefined ? undefined : { x: label.anchor === 'middle' ? label.x - w / 2 : label.x, y: label.y - EDGE_FONT, w, h: EDGE_FONT + 2 };
    return { from, to, segs, box };
  });
  for (const [i, { from, to, segs, box }] of routes.entries()) {
    for (let n = 0; n < boxes.length; n++) if (n !== from && n !== to && segs.some((s) => segHits(s, boxes[n]!, 2))) cost += 100;
    if (box) {
      if (boxes.some((n) => boxesMeet(box, n))) cost += 30;
      for (let j = 0; j < routes.length; j++) if (j !== i && routes[j]!.segs.some((s) => segHits(s, box, 0))) cost += 30;
    }
    if (cost > limit) return Infinity;
  }
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i]!;
    for (let j = i + 1; j < routes.length; j++) {
      const b = routes[j]!;
      const shared = a.from === b.from || a.to === b.to;
      for (const s of a.segs) for (const t of b.segs) {
        if (!shared && collinear(s, t) > 4) cost += 40;
        if (crosses(s, t)) cost += 2;
      }
    }
    if (cost > limit) return Infinity;
  }
  return cost;
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

  // Items by number: the nodes first, in diagram order, so cells and sizes share an index.
  const index = new Map<string, number>(ids.map((id, i) => [id, i]));
  for (const id of itemLayer.keys()) if (!index.has(id)) index.set(id, index.size);
  const layerItems = layers.map((items) => items.map((id) => index.get(id)!));
  const ws = ids.map((id) => size.get(id)!.w), hs = ids.map((id) => size.get(id)!.h);
  const cellC = Array<number>(index.size).fill(0), cellR = Array<number>(index.size).fill(0);
  const boxes: Box[] = ids.map((_, i) => ({ x: 0, y: 0, w: ws[i]!, h: hs[i]! }));
  const lines = links(ids, edges);
  const taken = new Set<number>();

  /** Puts every item in a grid cell and every node's box at its spot; returns the space cost, or undefined when two items share a cell. */
  const place = (band: Band, slots: number[][]): number | undefined => {
    taken.clear();
    let axisC = 0, axisR = 0, maxC = 0, maxR = 0, end = 0, minSlot = 0;
    for (let l = 0; l < count; l++) {
      const { dir, wrap } = band[l]!;
      if (l >= end) {
        // Lanes on the near side of any layer in the band, so a new band keeps clear of the last one's lanes.
        end = l + 1;
        while (end < count && !band[end]!.wrap) end++;
        minSlot = Infinity;
        for (let k = l; k < end; k++) for (const v of slots[k]!) minSlot = Math.min(minSlot, v);
      }
      // A new band starts past everything placed so far, beside the last layer.
      if (wrap && across(band[l - 1]!.dir)) axisR = maxR + 1 - (across(dir) ? minSlot : 0);
      else if (wrap) axisC = maxC + 1 - (across(dir) ? 0 : minSlot);
      else if (l > 0) {
        axisC += STEP[dir].c;
        axisR += STEP[dir].r;
      }
      const items = layerItems[l]!, lane = slots[l]!;
      for (let i = 0; i < items.length; i++) {
        const c = across(dir) ? axisC : axisC + lane[i]!, r = across(dir) ? axisR + lane[i]! : axisR;
        const key = c * 4096 + r;
        if (taken.has(key)) return undefined;
        taken.add(key);
        cellC[items[i]!] = c;
        cellR[items[i]!] = r;
      }
      for (const item of items) {
        maxC = Math.max(maxC, cellC[item]!);
        maxR = Math.max(maxR, cellR[item]!);
      }
    }
    let c0 = Infinity, r0 = Infinity, c1 = -Infinity, r1 = -Infinity;
    for (let i = 0; i < index.size; i++) {
      c0 = Math.min(c0, cellC[i]!);
      r0 = Math.min(r0, cellR[i]!);
      c1 = Math.max(c1, cellC[i]!);
      r1 = Math.max(r1, cellR[i]!);
    }
    const colW = Array<number>(c1 - c0 + 1).fill(0), rowH = Array<number>(r1 - r0 + 1).fill(0);
    for (let i = 0; i < ids.length; i++) {
      colW[cellC[i]! - c0] = Math.max(colW[cellC[i]! - c0]!, ws[i]!);
      rowH[cellR[i]! - r0] = Math.max(rowH[cellR[i]! - r0]!, hs[i]!);
    }
    const colX = [origin.x], rowY = [origin.y];
    for (let c = 1; c < colW.length; c++) colX.push(colX[c - 1]! + colW[c - 1]! + layoutGap(LAYOUT_GAP.x, colW[c - 1]!, colW[c]!, labelRoom));
    for (let r = 1; r < rowH.length; r++) rowY.push(rowY[r - 1]! + rowH[r - 1]! + layoutGap(LAYOUT_GAP.y, rowH[r - 1]!, rowH[r]!, EDGE_FONT));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < ids.length; i++) {
      const c = cellC[i]! - c0, r = cellR[i]! - r0;
      const box = boxes[i]!;
      box.x = Math.round(colX[c]! + (colW[c]! - box.w) / 2);
      box.y = Math.round(rowY[r]! + (rowH[r]! - box.h) / 2);
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    }
    return roomCost(minX, minY, maxX, maxY, room);
  };

  const bands = bandPatterns(count);
  const radix = options.map((o) => o.length);
  const total = radix.reduce((a, r) => a * r, 1);
  let best: { nodes: DiagramNode[]; cost: number; key: number } | undefined;
  /** Scores band `b` with lane choice `pick` (an index into each layer's options), keeping a new best; Infinity once past `limit` and the best. */
  const score = (b: number, pick: number[], limit: number): number => {
    const band = bands[b]!;
    const slots = pick.map((p, l) => options[l]![p]!);
    // Equal costs go to the earlier candidate, so the result does not depend on search order.
    const key = b * total + pick.reduce((a, p, l) => a * radix[l]! + p, 0);
    const beat = !best ? Infinity : key < best.key ? best.cost + 1e-9 : best.cost - 1e-9;
    const cap = Math.max(limit, beat);
    let base = band.filter((s) => s.wrap).length * 2 + (band[0]!.dir === 'TB' ? 0.5 : 0);
    for (const lane of slots) for (const s of lane) base += Math.abs(s) * 0.1;
    if (base > cap) return Infinity;
    const space = place(band, slots);
    if (space === undefined) return Infinity;
    // Every cost term only adds, so scoring stops as soon as the candidate cannot win.
    const cost = lineCost(boxes, lines, base + space, cap);
    if (cost < beat) best = { nodes: diagram.nodes.map((n, k): DiagramNode => ({ ...n, ...boxes[k]! })), cost, key };
    return cost;
  };
  // Lanes are tuned one layer at a time for every band pattern; only the most promising patterns try every lane combination.
  const ranked = bands.map((_, b) => {
    let pick = radix.map(() => 0);
    let cost = score(b, pick, Infinity);
    for (let round = 0, better = true; better && round < 3; round++) {
      better = false;
      for (let l = 0; l < count; l++) for (let p = 0; p < radix[l]!; p++) {
        if (p === pick[l]) continue;
        const next = pick.map((q, k) => (k === l ? p : q));
        const c = score(b, next, cost - 1e-9);
        if (c < cost - 1e-9) [pick, cost, better] = [next, c, true];
      }
    }
    return { b, cost };
  });
  for (const { b } of ranked.sort((x, y) => x.cost - y.cost).slice(0, 12)) {
    for (let i = 0; i < total; i++) {
      const pick = radix.map(() => 0);
      for (let l = count - 1, rest = i; l >= 0; l--) {
        pick[l] = rest % radix[l]!;
        rest = Math.floor(rest / radix[l]!);
      }
      score(b, pick, -Infinity);
    }
  }
  return { nodes: best?.nodes ?? [], edges };
}
