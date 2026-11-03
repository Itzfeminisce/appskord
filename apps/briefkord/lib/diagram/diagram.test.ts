import { describe, expect, it } from 'vitest';
import { sampleBoard } from '../board/sample';
import type { Diagram, DiagramNode } from '../board/types';
import { addEdge, addNode, deleteEdge, deleteNode, edgesValid, labelEdge, linkNode, updateNode } from './edit';
import { layoutDiagram, needsLayout, type UnplacedDiagram } from './layout';

const sample = (): Diagram => {
  const card = sampleBoard(1).cards.flow!;
  if (card.kind !== 'diagram') throw new Error('sample flow is not a diagram');
  return card.diagram;
};

const unplaced = (d: Diagram): UnplacedDiagram => ({ nodes: d.nodes.map(({ x: _x, y: _y, w: _w, h: _h, ...rest }) => rest), edges: d.edges });

const overlaps = (a: DiagramNode, b: DiagramNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const noOverlaps = (d: Diagram) => d.nodes.every((a, i) => d.nodes.slice(i + 1).every((b) => !overlaps(a, b)));

describe('layoutDiagram', () => {
  it('lays the sample out left to right: Cart, Address, Payment, Confirm', () => {
    const d = layoutDiagram(unplaced(sample()));
    const x = (label: string) => d.nodes.find((n) => n.label === label)!.x;
    expect(x('Cart')).toBeLessThan(x('Address'));
    expect(x('Address')).toBeLessThan(x('Payment'));
    expect(x('Payment')).toBeLessThan(x('Confirm'));
    expect(x('Payment')).toBeLessThan(x('Card saved?'));
    expect(noOverlaps(d)).toBe(true);
    expect(edgesValid(d)).toBe(true);
  });

  it('keeps the main path on one row', () => {
    const d = layoutDiagram(unplaced(sample()));
    const mid = (label: string) => { const n = d.nodes.find((m) => m.label === label)!; return n.y + n.h / 2; };
    expect(new Set(['Cart', 'Address', 'Payment', 'Confirm'].map(mid)).size).toBe(1);
  });

  it('never overlaps, with loops, loose nodes and many branches', () => {
    const nodes = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, kind: (i % 3 === 0 ? 'choice' : 'step') as 'choice' | 'step', label: `N${i}`, colour: 'white' as const }));
    const edges = [[0, 1], [1, 2], [2, 0], [1, 3], [1, 4], [1, 5], [5, 6], [6, 7], [3, 7], [9, 10], [10, 9], [12, 12]].map(([a, b], i) => ({ id: `e${i}`, from: `n${a}`, to: `n${b}` }));
    const d = layoutDiagram({ nodes, edges });
    expect(d.nodes).toHaveLength(14);
    expect(d.nodes.every((n) => [n.x, n.y, n.w, n.h].every(Number.isFinite))).toBe(true);
    expect(noOverlaps(d)).toBe(true);
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
