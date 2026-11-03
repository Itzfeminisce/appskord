import { describe, expect, it } from 'vitest';
import { sampleBoard } from '../board/sample';
import type { Diagram, DiagramNode } from '../board/types';
import { addEdge, addNode, deleteEdge, deleteNode, edgesValid, labelEdge, linkNode, updateNode } from './edit';
import { LAYOUT_ROOM, layoutCost, layoutDiagram, needsLayout, type UnplacedDiagram } from './layout';
import { routeEdge, routeSegments } from './route';

const sample = (): Diagram => {
  const card = sampleBoard(1).cards.flow!;
  if (card.kind !== 'diagram') throw new Error('sample flow is not a diagram');
  return card.diagram;
};

const unplaced = (d: Diagram): UnplacedDiagram => ({ nodes: d.nodes.map(({ x: _x, y: _y, w: _w, h: _h, ...rest }) => rest), edges: d.edges });

const overlaps = (a: DiagramNode, b: DiagramNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlaps = (d: Diagram) => d.nodes.every((a, i) => d.nodes.slice(i + 1).every((b) => !overlaps(a, b)));

describe('layoutDiagram', () => {
  const fitScale = (d: Diagram) => {
    const w = Math.max(...d.nodes.map((n) => n.x + n.w)) - Math.min(...d.nodes.map((n) => n.x)) + 32;
    const h = Math.max(...d.nodes.map((n) => n.y + n.h)) - Math.min(...d.nodes.map((n) => n.y)) + 32;
    return Math.min(LAYOUT_ROOM.w / w, LAYOUT_ROOM.h / h);
  };
  /** Every connector clear of other nodes, and every label clear of nodes and other connectors. */
  const readable = (d: Diagram) => {
    const byId = new Map(d.nodes.map((n) => [n.id, n]));
    const inside = (x: number, y: number, n: DiagramNode) => x > n.x + 2 && x < n.x + n.w - 2 && y > n.y + 2 && y < n.y + n.h - 2;
    return d.edges.every((e) => {
      const route = routeEdge(byId.get(e.from)!, byId.get(e.to)!);
      const points = routeSegments(route.d).flatMap((s) => Array.from({ length: 21 }, (_, i) => [s.x1 + ((s.x2 - s.x1) * i) / 20, s.y1 + ((s.y2 - s.y1) * i) / 20] as const));
      const clear = d.nodes.every((n) => n.id === e.from || n.id === e.to || points.every(([x, y]) => !inside(x, y, n)));
      const label = !e.label || d.nodes.every((n) => !inside(route.label!.x, route.label!.y - 4, n));
      return clear && label;
    });
  };

  it('lays the sample out in reading order, wrapped to fit the preview at full size', () => {
    const d = layoutDiagram(unplaced(sample()));
    const at = (label: string) => d.nodes.find((n) => n.label === label)!;
    expect(at('Cart').x).toBeLessThan(at('Address').x);
    expect(at('Address').x).toBeLessThan(at('Payment').x);
    expect(at('Card saved?').y).toBeGreaterThan(at('Payment').y);
    expect(fitScale(d)).toBeGreaterThanOrEqual(0.98);
    expect(noOverlaps(d)).toBe(true);
    expect(edgesValid(d)).toBe(true);
    expect(layoutCost(d.nodes, d.edges)).toBeLessThan(10);
  });

  it('keeps the yes line from Card saved? to Confirm and its label in sight', () => {
    const d = layoutDiagram(unplaced(sample()));
    expect(readable(d)).toBe(true);
    const saved = d.nodes.find((n) => n.id === 'saved')!, confirm = d.nodes.find((n) => n.id === 'confirm')!;
    expect(saved.y === confirm.y && saved.x < confirm.x).toBe(false);
  });

  it('puts a choice that skips a step on its own lane (Cart, address, choice; No: Pay; Yes: Confirm)', () => {
    const nodes = [['a', 'step', 'Cart'], ['b', 'step', 'Enter address'], ['c', 'choice', 'Card saved?'], ['d', 'step', 'Pay'], ['e', 'end', 'Confirm']]
      .map(([id, kind, label]) => ({ id: id!, kind: kind as DiagramNode['kind'], label: label!, colour: 'white' as const }));
    const edges = [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }, { id: 'e3', from: 'c', to: 'd', label: 'No' }, { id: 'e4', from: 'c', to: 'e', label: 'Yes' }, { id: 'e5', from: 'd', to: 'e' }];
    const d = layoutDiagram({ nodes, edges });
    expect(readable(d)).toBe(true);
    expect(fitScale(d)).toBeGreaterThanOrEqual(0.98);
    expect(noOverlaps(d)).toBe(true);
  });

  it('never overlaps, with loops, loose nodes and many branches', () => {
    const nodes = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, kind: (i % 3 === 0 ? 'choice' : 'step') as 'choice' | 'step', label: `N${i}`, colour: 'white' as const }));
    const edges = [[0, 1], [1, 2], [2, 0], [1, 3], [1, 4], [1, 5], [5, 6], [6, 7], [3, 7], [9, 10], [10, 9], [12, 12]].map(([a, b], i) => ({ id: `e${i}`, from: `n${a}`, to: `n${b}` }));
    const d = layoutDiagram({ nodes, edges });
    expect(d.nodes).toHaveLength(14);
    expect(d.nodes.every((n) => [n.x, n.y, n.w, n.h].every(Number.isFinite))).toBe(true);
    expect(noOverlaps(d)).toBe(true);
  });

  it('lays out an empty diagram', () => {
    expect(layoutDiagram({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });

  it('drops edges to missing nodes', () => {
    const d = layoutDiagram({ nodes: [{ id: 'a', kind: 'step', label: 'A', colour: 'white' }], edges: [{ id: 'e', from: 'a', to: 'gone' }] });
    expect(d.edges).toEqual([]);
  });

  it('knows when a diagram needs a layout', () => {
    expect(needsLayout(sample())).toBe(false);
    expect(needsLayout(unplaced(sample()))).toBe(true);
    expect(needsLayout({ nodes: sample().nodes.map((n) => ({ ...n, x: 0, y: 0 })), edges: [] })).toBe(true);
  });
});

describe('diagram edits', () => {
  it('deleting a node removes its edges and leaves every edge valid', () => {
    const d = deleteNode(sample(), 'payment');
    expect(d.nodes.some((n) => n.id === 'payment')).toBe(false);
    expect(d.edges.map((e) => e.id)).toEqual(['e1', 'e5', 'e6']);
    expect(edgesValid(d)).toBe(true);
  });

  it('refuses self, duplicate and dangling edges', () => {
    const d = sample();
    expect(addEdge(d, { id: 'x', from: 'cart', to: 'cart' })).toBe(d);
    expect(addEdge(d, { id: 'x', from: 'cart', to: 'address' })).toBe(d);
    expect(addEdge(d, { id: 'x', from: 'cart', to: 'gone' })).toBe(d);
    expect(addEdge(d, { id: 'x', from: 'cart', to: 'confirm' }).edges).toHaveLength(7);
  });

  it('adds, moves, colours, links and labels', () => {
    let d = addNode(sample(), { id: 'new', kind: 'text', label: 'Text', x: 0, y: 0, w: 10, h: 10, colour: 'white' });
    expect(addNode(d, d.nodes[0]!)).toBe(d);
    d = updateNode(d, 'new', { x: 5, colour: 'teal' });
    expect(d.nodes.at(-1)).toMatchObject({ x: 5, colour: 'teal' });
    expect(updateNode(d, 'new', { x: 5 })).toBe(d);
    d = linkNode(d, 'new', 'why-now');
    expect(d.nodes.at(-1)!.card).toBe('why-now');
    d = linkNode(d, 'new', undefined);
    expect('card' in d.nodes.at(-1)!).toBe(false);
    d = labelEdge(d, 'e1', ' then ');
    expect(d.edges[0]!.label).toBe('then');
    d = labelEdge(d, 'e1', '');
    expect('label' in d.edges[0]!).toBe(false);
    expect(deleteEdge(d, 'e1').edges).toHaveLength(5);
  });
});
