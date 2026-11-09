import * as THREE from 'three';
import { UNIT } from './scene';

export type Point = [number, number];

const clamp01 = (x: number): number => (x > 0 ? (x >= 1 ? 1 : x) : 0);

/** Points along a cubic Bézier, excluding its start. */
function cubic(a: Point, b: Point, c: Point, d: Point, steps: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
    out.push([
      k[0] * a[0] + k[1] * b[0] + k[2] * c[0] + k[3] * d[0],
      k[0] * a[1] + k[1] * b[1] + k[2] * c[1] + k[3] * d[1],
    ]);
  }
  return out;
}

/** SVG path data (M L H V C S Q T Z, absolute or relative) as polylines, one per subpath. Curves become `steps` points. */
export function parsePath(d: string, steps = 16): Point[][] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const paths: Point[][] = [];
  let line: Point[] = [];
  let cur: Point = [0, 0];
  let start: Point = [0, 0];
  let ctrl: Point | null = null;
  let cmd = '';
  let i = 0;
  const num = (): number => {
    const t = tokens[i];
    if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error(`Motikord: path command ${cmd} is missing operands`);
    i++;
    return Number(t);
  };
  const pt = (rel: boolean): Point => {
    const x = num();
    const y = num();
    return rel ? [cur[0] + x, cur[1] + y] : [x, y];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i] as string)) cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C !== 'M' && C !== 'Z' && !line.length) line = [cur]; // a draw after Z starts a new subpath
    if (C === 'M') {
      if (line.length) paths.push(line);
      cur = pt(rel);
      start = cur;
      line = [cur];
      cmd = rel ? 'l' : 'L'; // extra pairs after M are line-tos
    } else if (C === 'L') {
      cur = pt(rel);
      line.push(cur);
    } else if (C === 'H') {
      cur = [rel ? cur[0] + num() : num(), cur[1]];
      line.push(cur);
    } else if (C === 'V') {
      cur = [cur[0], rel ? cur[1] + num() : num()];
      line.push(cur);
    } else if (C === 'C' || C === 'S') {
      const c1: Point = C === 'C' ? pt(rel) : ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur;
      const c2 = pt(rel);
      const end = pt(rel);
      line.push(...cubic(cur, c1, c2, end, steps));
      ctrl = c2;
      cur = end;
      continue;
    } else if (C === 'Q' || C === 'T') {
      const q: Point = C === 'Q' ? pt(rel) : ctrl ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur;
      const end = pt(rel);
      const c1: Point = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])];
      const c2: Point = [end[0] + (2 / 3) * (q[0] - end[0]), end[1] + (2 / 3) * (q[1] - end[1])];
      line.push(...cubic(cur, c1, c2, end, steps));
      ctrl = q;
      cur = end;
      continue;
    } else if (C === 'Z') {
      if (line.length) {
        line.push(start);
        paths.push(line);
        line = [];
      }
      cur = start;
    } else {
      throw new Error(`Motikord: path command ${cmd} is not supported`);
    }
    ctrl = null;
  }
  if (line.length) paths.push(line);
  return paths;
}

/** Total length of a polyline. */
export function pathLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Line-draw: the first `draw` (0..1) of a polyline by length, ending exactly on the drawn point. */
export function drawPoints(points: readonly Point[], draw: number): Point[] {
  const p = clamp01(draw);
  if (points.length < 2 || p === 1) return points.map((q) => [q[0], q[1]]);
  const first = points[0] as Point;
  let left = pathLength(points) * p;
  const out: Point[] = [[first[0], first[1]]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg >= left) {
      const k = seg === 0 ? 0 : left / seg;
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
      return out;
    }
    out.push([b[0], b[1]]);
    left -= seg;
  }
  return out;
}

/** The SVG dash for a line-draw on a path with pathLength 100, as drawn in MotionV3 ("10 100" at 10%). */
export function drawDash(draw: number): string {
  return `${Math.round(clamp01(draw) * 1000) / 10} 100`;
}

/** A stroked path in the scene graph whose drawn length follows the layer's `draw` track. */
export class PathLine extends THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  readonly points: Point[];

  constructor(points: readonly Point[], color: THREE.ColorRepresentation = '#111114') {
    const position = new THREE.BufferAttribute(new Float32Array(points.length * 3), 3);
    const geometry = new THREE.BufferGeometry().setAttribute('position', position);
    super(geometry, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.points = points.map((q) => [q[0], q[1]]);
    this.setDraw(1);
  }

  /** Re-lays the vertices for `draw`; recipe units become world units, y up. */
  setDraw(draw: number): void {
    const drawn = drawPoints(this.points, draw);
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    drawn.forEach(([x, y], i) => position.setXYZ(i, x * UNIT, -y * UNIT, 0));
    position.needsUpdate = true;
    this.geometry.setDrawRange(0, drawn.length);
    this.geometry.computeBoundingSphere();
  }

  /** Reads the frame's state that applyFrame left on the layer group. */
  update(userData: { draw?: number; opacity?: number }): void {
    this.setDraw(userData.draw ?? 1);
    this.material.opacity = userData.opacity ?? 1;
  }
}

/** Joins whose miter would pass this many half-widths are bevelled. */
export const MITER_LIMIT = 4;

const samePoint = (a: Point, b: Point): boolean => a[0] === b[0] && a[1] === b[1];

/** Runs of equal consecutive points: each run's first index, and whether the line ends where it starts. */
function runs(points: readonly Point[]): { starts: number[]; closed: boolean } {
  const starts: number[] = [];
  points.forEach((p, i) => {
    if (!i || !samePoint(points[i - 1]!, p)) starts.push(i);
  });
  const m = starts.length;
  return { starts, closed: m > 3 && samePoint(points[0]!, points[points.length - 1]!) };
}

/** Unit normals of the segments into and out of distinct point `j` (wrapping at a closed line's seam). */
function joinNormals(
  points: readonly Point[],
  starts: readonly number[],
  closed: boolean,
  j: number,
): [Point | undefined, Point | undefined] {
  const m = starts.length;
  const at = (k: number): Point => points[starts[k]!]!;
  const normal = (a: Point, b: Point): Point => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  };
  const prev = j > 0 ? at(j - 1) : closed ? at(m - 2) : undefined;
  const next = j < m - 1 ? at(j + 1) : closed ? at(1) : undefined;
  return [prev && normal(prev, at(j)), next && normal(at(j), next)];
}

/** cos of half the turn at a join: the miter is 1/cos half-widths long. */
const halfTurnCos = (n0: Point, n1: Point): number => Math.hypot(n0[0] + n1[0], n0[1] + n1[1]) / 2;

/** The line with each join sharper than the miter limit doubled, so strokeStrip can bevel it. */
export function splitSharpJoins(points: readonly Point[], miterLimit = MITER_LIMIT): Point[] {
  const { starts, closed } = runs(points);
  const out: Point[] = [];
  starts.forEach((i, j) => {
    const p = points[i]!;
    out.push(p);
    const [n0, n1] = joinNormals(points, starts, closed, j);
    if (n0 && n1 && halfTurnCos(n0, n1) * miterLimit < 1) out.push(p);
  });
  return out;
}

/**
 * The two edges of a stroke `width` wide along a polyline, written as [lx, ly, rx, ry] per point into `out`
 * (grown when too short). Repeated points share one join; joins are mitred (half / cos(θ/2) out) up to
 * `miterLimit` half-widths. Past it, a doubled point bevels (its first copy ends the incoming segment, its last
 * starts the outgoing one) and a single point clips the miter at the limit. A line that ends where it starts
 * joins across the seam. Recipe units, y down.
 */
export function strokeStrip(
  points: readonly Point[],
  width: number,
  out?: Float32Array,
  miterLimit = MITER_LIMIT,
): Float32Array {
  const n = points.length;
  const strip = out && out.length >= n * 4 ? out : new Float32Array(n * 4);
  const half = width / 2;
  const { starts, closed } = runs(points);
  const put = (i: number, [x, y]: Point): void => {
    const p = points[i]!;
    strip[i * 4] = p[0] + x;
    strip[i * 4 + 1] = p[1] + y;
    strip[i * 4 + 2] = p[0] - x;
    strip[i * 4 + 3] = p[1] - y;
  };
  starts.forEach((first, j) => {
    const last = (starts[j + 1] ?? n) - 1;
    const [n0, n1] = joinNormals(points, starts, closed, j);
    const scaled = (v: Point, k: number): Point => [v[0] * k, v[1] * k];
    let a: Point = [0, 0];
    let b: Point = [0, 0];
    if (n0 && n1) {
      const cos = halfTurnCos(n0, n1);
      const miter: Point = cos > 1e-9 ? [(n0[0] + n1[0]) / (2 * cos), (n0[1] + n1[1]) / (2 * cos)] : n1;
      if (cos * miterLimit >= 1) a = b = scaled(miter, half / cos);
      else if (last > first) [a, b] = [scaled(n0, half), scaled(n1, half)];
      else a = b = scaled(miter, cos > 1e-9 ? half * miterLimit : half);
    } else if (n0 || n1) a = b = scaled((n0 ?? n1)!, half);
    for (let i = first; i <= last; i++) put(i, i === first ? a : b);
  });
  return strip;
}

/** A stroke with real width (a triangle strip; GL lines are always 1 px) whose drawn length follows `draw`. */
export class StrokeMesh extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  private points: Point[] = [];
  private strip: Float32Array = new Float32Array(0);

  constructor(
    points: readonly Point[],
    readonly width: number,
    color: THREE.ColorRepresentation = '#111114',
  ) {
    super(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }),
    );
    this.setPoints(points, 1);
  }

  /** Swaps the polyline (rigs deform it) and lays it out for `draw`; buffers grow only when the line does. */
  setPoints(points: readonly Point[], draw: number): void {
    this.points = points as Point[];
    this.setDraw(draw);
  }

  private grow(n: number): void {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (position && position.count >= n * 2) return;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const index: number[] = [];
    for (let i = 0; i + 1 < n; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.geometry.setIndex(index);
  }

  setDraw(draw: number): void {
    const drawn = splitSharpJoins(drawPoints(this.points, draw));
    this.grow(drawn.length);
    this.strip = strokeStrip(drawn, this.width, this.strip);
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < drawn.length; i++) {
      position.setXYZ(i * 2, this.strip[i * 4]! * UNIT, -this.strip[i * 4 + 1]! * UNIT, 0);
      position.setXYZ(i * 2 + 1, this.strip[i * 4 + 2]! * UNIT, -this.strip[i * 4 + 3]! * UNIT, 0);
    }
    position.needsUpdate = true;
    this.geometry.setDrawRange(0, Math.max(0, drawn.length - 1) * 6);
    this.geometry.computeBoundingSphere();
  }
}
