/** Right-angle connectors between diagram nodes: the board, the editor and the layout all use this one route. */

export interface Box { x: number; y: number; w: number; h: number }

export interface EdgeRoute { d: string; label?: { x: number; y: number; anchor: 'middle' | 'start' } }

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(a0, b0) < Math.min(a1, b1);

/** A connector from `a` to `b`: straight when they share a row or column, otherwise out sideways then into the near edge. */
export function routeEdge(a: Box, b: Box): EdgeRoute {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  if (overlap(a.x, a.x + a.w, b.x, b.x + b.w)) {
    const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
    const down = cb.y > ca.y;
    const y1 = down ? a.y + a.h : a.y, y2 = down ? b.y - 2 : b.y + b.h + 2;
    return { d: `M${x} ${y1}V${y2}`, label: { x: x + 6, y: (y1 + y2) / 2, anchor: 'start' } };
  }
  if (overlap(a.y, a.y + a.h, b.y, b.y + b.h)) {
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
    const right = cb.x > ca.x;
    const x1 = right ? a.x + a.w : a.x, x2 = right ? b.x - 2 : b.x + b.w + 2;
    return { d: `M${x1} ${y}H${x2}`, label: { x: (x1 + x2) / 2, y: y - 6, anchor: 'middle' } };
  }
  const right = cb.x > ca.x;
  const down = cb.y > ca.y;
  const x1 = right ? a.x + a.w : a.x;
  const y2 = down ? b.y - 2 : b.y + b.h + 2;
  return { d: `M${x1} ${ca.y}H${cb.x}V${y2}`, label: { x: (x1 + cb.x) / 2, y: ca.y - 6, anchor: 'middle' } };
}

export interface Segment { x1: number; y1: number; x2: number; y2: number }

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
