import { describe, expect, it } from 'vitest';
import type { DiagramNode, DiagramNodeKind } from '../board/types';
import { layoutDiagram, type UnplacedDiagram } from './layout';
import { routeEdge, routeSegments } from './route';
import { fitLabel, fitNode, fitNodes, LABEL_FONT, LINE_HEIGHT, measureText, nodeLines, relabel, wrapLabel } from './size';

const LONG = [
  'Customer opens the checkout page', 'Load saved addresses from the account', 'Address on file?', 'Ask for a full shipping address',
  'Validate the postcode with the courier', 'Show delivery options and prices', 'Customer picks next day delivery', 'Card saved?',
  'Ask for card number, expiry and security code', 'Run the fraud check with the payment provider', 'Fraud check passed?',
  'Hold the order for manual review by the team', 'Charge the card for the full order amount', 'Payment authorised?',
  'Show a friendly error and keep the basket', 'Reserve the stock in the nearest warehouse', 'Send the order confirmation email',
  'Create the shipping label', 'Hand the parcel to the courier', 'Order delivered',
];

/** A 20-step flow with long labels: steps, choices with yes and no, and a start and end. */
function longFlow(): UnplacedDiagram {
  const nodes = LONG.map((label, i) => ({ id: `n${i}`, kind: (label.endsWith('?') ? 'choice' : i === 0 || i === LONG.length - 1 ? 'end' : 'step') as DiagramNodeKind, label, colour: 'white' as const }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${i}`, to: n.id, ...(nodes[i]!.kind === 'choice' ? { label: 'yes' } : {}) }));
  edges.push({ id: 'x1', from: 'n2', to: 'n4', label: 'no' }, { id: 'x2', from: 'n10', to: 'n12', label: 'no' }, { id: 'x3', from: 'n13', to: 'n15', label: 'no' });
  return { nodes, edges };
}

/** True when every line of the node's label sits inside its shape. */
function labelInside(n: DiagramNode): boolean {
  const lines = nodeLines(n);
  const tw = Math.max(...lines.map((l) => measureText(l))), th = lines.length * LABEL_FONT * LINE_HEIGHT;
  if (lines.length > 2) return false;
  if (n.kind === 'choice') return tw / n.w + th / n.h <= 1;
  return tw <= n.w - 16 && th <= n.h - 8;
}

describe('label sizing', () => {
  it('measures wider text as wider and scales with the font', () => {
    expect(measureText('WWW')).toBeGreaterThan(measureText('iii'));
    expect(measureText('Payment', 28)).toBeGreaterThanOrEqual(2 * measureText('Payment', 14) - 1);
  });

  it('keeps a short label on one line and splits a long one in two even lines', () => {
    expect(wrapLabel('Cart', 180)).toEqual(['Cart']);
    const lines = wrapLabel('Ask for card number, expiry and security code', 180);
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe('Ask for card number, expiry and security code');
  });

  it('never wraps past two lines; the shape grows wider instead', () => {
    const long = 'Run the fraud check with the payment provider and wait for the answer before charging';
    const fit = fitLabel('step', long);
    expect(fit.lines).toHaveLength(2);
    expect(fit.w).toBeGreaterThan(180);
    expect(labelInside({ id: 'a', kind: 'step', label: long, colour: 'white', x: 0, y: 0, ...fit })).toBe(true);
  });

  it('sizes a diamond so its text fits inside the diamond', () => {
    for (const label of ['Ok?', 'Card saved?', 'Payment authorised by the bank?']) {
      const fit = fitLabel('choice', label);
      expect(labelInside({ id: 'c', kind: 'choice', label, colour: 'yellow', x: 0, y: 0, ...fit })).toBe(true);
    }
  });

  it('grows a small node about its centre and leaves a fitting one alone', () => {
    const small: DiagramNode = { id: 'a', kind: 'step', label: 'Validate the postcode with the courier', colour: 'white', x: 100, y: 100, w: 60, h: 30 };
    const grown = fitNode(small);
    expect(Math.abs(grown.x + grown.w / 2 - 130)).toBeLessThanOrEqual(1);
    expect(Math.abs(grown.y + grown.h / 2 - 115)).toBeLessThanOrEqual(1);
    expect(labelInside(grown)).toBe(true);
    expect(fitNode(grown)).toBe(grown);
    const d = { nodes: [grown], edges: [] };
    expect(fitNodes(d)).toBe(d);
  });

  it('spreads grown nodes apart so they never meet, keeping their arrangement', () => {
    const node = (id: string, label: string, x: number): DiagramNode => ({ id, kind: 'step', label, colour: 'white', x, y: 0, w: 60, h: 30 });
    const d = fitNodes({ nodes: [node('a', 'Ask for a full shipping address', 0), node('b', 'Validate the postcode with the courier', 70), node('c', 'Done', 140)], edges: [] });
    const [a, b, c] = d.nodes as [DiagramNode, DiagramNode, DiagramNode];
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(b.x + b.w).toBeLessThan(c.x);
    expect(d.nodes.every(labelInside)).toBe(true);
  });

  it('resizes a renamed node to its new label', () => {
    const n: DiagramNode = { id: 'a', kind: 'step', label: 'Cart', colour: 'white', x: 0, y: 0, ...fitLabel('step', 'Cart') };
    const r = relabel(n, 'Hold the order for manual review by the team');
    expect(r.w).toBeGreaterThan(n.w);
    expect(labelInside(r)).toBe(true);
  });
});

describe('layout of a long 20-step flow', () => {
  const d = layoutDiagram(longFlow());
  const byId = new Map(d.nodes.map((n) => [n.id, n]));

  it('fits every label inside its shape, in at most two lines', () => {
    expect(d.nodes).toHaveLength(20);
    expect(d.nodes.every(labelInside)).toBe(true);
  });

  it('keeps shapes apart and arrows and their labels off other shapes', () => {
    const meet = (a: DiagramNode, b: DiagramNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(d.nodes.every((a, i) => d.nodes.slice(i + 1).every((b) => !meet(a, b)))).toBe(true);
    const inside = (x: number, y: number, n: DiagramNode) => x > n.x + 2 && x < n.x + n.w - 2 && y > n.y + 2 && y < n.y + n.h - 2;
    for (const e of d.edges) {
      const route = routeEdge(byId.get(e.from)!, byId.get(e.to)!);
      const pts = routeSegments(route.d).flatMap((s) => Array.from({ length: 41 }, (_, i) => [s.x1 + ((s.x2 - s.x1) * i) / 40, s.y1 + ((s.y2 - s.y1) * i) / 40] as const));
      for (const n of d.nodes) if (n.id !== e.from && n.id !== e.to) expect(pts.some(([x, y]) => inside(x, y, n))).toBe(false);
      if (e.label) expect(d.nodes.some((n) => inside(route.label!.x, route.label!.y - 4, n))).toBe(false);
    }
  });

  it('spaces bigger shapes further apart', () => {
    const small = layoutDiagram({ nodes: [{ id: 'a', kind: 'step', label: 'A', colour: 'white' }, { id: 'b', kind: 'step', label: 'B', colour: 'white' }], edges: [{ id: 'e', from: 'a', to: 'b' }] });
    const big = layoutDiagram({ nodes: [{ id: 'a', kind: 'step', label: LONG[8]!, colour: 'white' }, { id: 'b', kind: 'step', label: LONG[9]!, colour: 'white' }], edges: [{ id: 'e', from: 'a', to: 'b' }] });
    const gap = (x: typeof small) => {
      const [a, b] = x.nodes as [DiagramNode, DiagramNode];
      return Math.max(b.x - (a.x + a.w), b.y - (a.y + a.h));
    };
    expect(gap(big)).toBeGreaterThan(gap(small));
  });
});
