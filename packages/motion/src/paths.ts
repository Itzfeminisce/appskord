import * as THREE from 'three';
import { UNIT } from './scene';

export type Point = [number, number];

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

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
  const num = (): number => Number(tokens[i++]);
  const pt = (rel: boolean): Point => {
    const x = num();
    const y = num();
    return rel ? [cur[0] + x, cur[1] + y] : [x, y];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i] as string)) cmd = tokens[i++] as string;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
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
      if (line.length) line.push(start);
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
