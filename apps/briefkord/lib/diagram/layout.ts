/** Layered left-to-right layout for diagrams whose nodes have no places yet, such as the ones AI makes. */
import type { Diagram, DiagramEdge, DiagramNode } from '../board/types';
import { NODE_SIZE } from './edit';

export type UnplacedNode = Omit<DiagramNode, 'x' | 'y' | 'w' | 'h'> & Partial<Pick<DiagramNode, 'x' | 'y' | 'w' | 'h'>>;
export interface UnplacedDiagram { nodes: UnplacedNode[]; edges: DiagramEdge[] }

export const LAYOUT_GAP = { x: 62, y: 70 };

const placed = (n: UnplacedNode): n is DiagramNode => [n.x, n.y, n.w, n.h].every((v) => typeof v === 'number' && Number.isFinite(v));

/** True when some node has no place, or every node sits on the same spot. */
export function needsLayout(diagram: UnplacedDiagram): boolean {
  if (!diagram.nodes.every(placed)) return true;
  const spots = new Set((diagram.nodes as DiagramNode[]).map((n) => `${n.x},${n.y}`));
  return diagram.nodes.length > 1 && spots.size === 1;
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

/** Places every node: a node's column is its longest path from a start; rows follow the nodes before them. */
export function layoutDiagram(diagram: UnplacedDiagram, origin = { x: 0, y: 0 }): Diagram {
  const ids = diagram.nodes.map((n) => n.id);
  const forward = forwardEdges(ids, diagram.edges);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of forward) preds.get(e.to)!.push(e.from);

  const layer = new Map<string, number>();
  const layerOf = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    layer.set(id, 0);
    const value = Math.max(0, ...preds.get(id)!.map((p) => layerOf(p) + 1));
    layer.set(id, value);
    return value;
  };
  ids.forEach(layerOf);

  const columns: string[][] = [];
  for (const id of ids) (columns[layer.get(id)!] ??= []).push(id);
  const row = new Map<string, number>();
  for (const column of columns) {
    if (!column) continue;
    const wish = (id: string) => {
      const p = preds.get(id)!.map((q) => row.get(q)).filter((r): r is number => r !== undefined);
      return p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0;
    };
    // Stable sort keeps input order on ties, so the main path stays on the first row.
    const order = column.map((id, i) => ({ id, i, w: wish(id) })).sort((a, b) => a.w - b.w || a.i - b.i);
    order.forEach(({ id }, r) => row.set(id, r));
  }

  const size = new Map(diagram.nodes.map((n) => [n.id, { w: n.w && n.w > 0 ? n.w : NODE_SIZE[n.kind].w, h: n.h && n.h > 0 ? n.h : NODE_SIZE[n.kind].h }]));
  const colW = columns.map((c) => Math.max(0, ...(c ?? []).map((id) => size.get(id)!.w)));
  const rows = Math.max(0, ...[...row.values()].map((r) => r + 1));
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...ids.filter((id) => row.get(id) === r).map((id) => size.get(id)!.h)));
  const colX = colW.map((_, c) => origin.x + colW.slice(0, c).reduce((a, w) => a + w + LAYOUT_GAP.x, 0));
  const rowY = rowH.map((_, r) => origin.y + rowH.slice(0, r).reduce((a, h) => a + h + LAYOUT_GAP.y, 0));

  const nodes = diagram.nodes.map((n): DiagramNode => {
    const { w, h } = size.get(n.id)!;
    const c = layer.get(n.id)!, r = row.get(n.id)!;
    return { ...n, w, h, x: Math.round(colX[c]! + (colW[c]! - w) / 2), y: Math.round(rowY[r]! + (rowH[r]! - h) / 2) };
  });
  const known = new Set(ids);
  return { nodes, edges: diagram.edges.filter((e) => known.has(e.from) && known.has(e.to)) };
}
