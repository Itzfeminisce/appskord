/** Right-angle connectors between diagram nodes: the board, the editor and the layout all use this one route. */

export interface Box { x: number; y: number; w: number; h: number }

export interface EdgeRoute { d: string; label?: { x: number; y: number; anchor: 'middle' | 'start' } }

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0, b0) < Math.min(a1, b1);

export interface Segment { x1: number; y1: number; x2: number; y2: number }

/** A connector from `a` to `b`: straight when they share a row or column, otherwise out sideways then into the near edge. */
export function routeEdge(a: Box, b: Box): EdgeRoute {
  const { segs, label } = routeEdgeSegments(a, b);
  let d = `M${segs[0]!.x1} ${segs[0]!.y1}`;
  for (const s of segs) d += s.x1 === s.x2 ? `V${s.y2}` : `H${s.x2}`;
  return { d, label };
}

/** The same connector as `routeEdge`, as straight pieces, for code that measures many routes. */
export function routeEdgeSegments(a: Box, b: Box): { segs: Segment[]; label: NonNullable<EdgeRoute['label']> } {
  const cax = a.x + a.w / 2, cay = a.y + a.h / 2;
  const cbx = b.x + b.w / 2, cby = b.y + b.h / 2;
  if (overlap(a.x, a.x + a.w, b.x, b.x + b.w)) {
    const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
    const down = cby > cay;
    const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y - 2 : b.y + b.h + 2;
    return { segs: [{ x1: x, y1, x2: x, y2 }], label: { x: x + 6, y: (y1 + y2) / 2, anchor: 'start' } };
  }
  if (overlap(a.y, a.y + a.h, b.y, b.y + b.h)) {
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
    const right = cbx > cax;
    const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x - 2 : b.x + b.w + 2;
    return { segs: [{ x1, y1: y, x2, y2: y }], label: { x: (x1 + x2) / 2, y: y - 6, anchor: 'middle' } };
  }
  const right = cbx > cax;
  const down = cby > cay;
  const x1 = right ? a.x + a.w : a.x;
  const y2 = down ? b.y - 2 : b.y + b.h + 2;
  return { segs: [{ x1, y1: cay, x2: cbx, y2: cay }, { x1: cbx, y1: cay, x2: cbx, y2 }], label: { x: (x1 + cbx) / 2, y: cay - 6, anchor: 'middle' } };
}

/** The straight pieces of a route's `d` (M, H and V only). */
export function routeSegments(d: string): Segment[] {
  const out: Segment[] = [];
  let x = 0, y = 0;
  for (const [, op, a, b] of d.matchAll(/([MHV])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
    if (op === 'M') {
      x = Number(a);
      y = Number(b);
      continue;
    }
    const nx = op === 'H' ? Number(a) : x, ny = op === 'V' ? Number(a) : y;
    out.push({ x1: x, y1: y, x2: nx, y2: ny });
    x = nx;
    y = ny;
  }
  return out;
}
