import * as THREE from 'three';
import type { Point } from './paths';
import { UNIT } from './scene';

const rotate = (points: Point[], deg: number): Point[] => {
  if (!deg) return points;
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
};

/** A rounded rectangle centred on 0,0, clockwise from the top edge; `radius` is clamped to half the short side. */
export function roundedRect(width: number, height: number, radius = 0, deg = 0, cornerSteps = 8): Point[] {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const hw = width / 2;
  const hh = height / 2;
  const corners: [number, number, number][] = [
    [hw - r, -hh + r, -90],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, 90],
    [-hw + r, -hh + r, 180],
  ];
  const points: Point[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= cornerSteps; i++) {
      const a = ((a0 + (90 * i) / cornerSteps) * Math.PI) / 180;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      if (r === 0) break;
    }
  }
  return rotate(points, deg);
}

/** A circle centred on 0,0 as `steps` points, clockwise from the top. */
export function circle(radius: number, steps = 48): Point[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / steps;
    return [radius * Math.cos(a), radius * Math.sin(a)] as Point;
  });
}

/** A soft organic blob filling a `width` x `height` ellipse, clockwise from the top. */
export function blob(width: number, height: number, steps = 48): Point[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / steps;
    const r = 0.84 + 0.1 * Math.sin(3 * a + 0.6) + 0.06 * Math.sin(5 * a + 1.3);
    return [(width / 2) * r * Math.cos(a), (height / 2) * r * Math.sin(a)] as Point;
  });
}

/** An arch centred on 0,0: a half circle on straight sides, clockwise from the top. */
export function arch(width: number, height: number, steps = 24): Point[] {
  const r = Math.min(width / 2, height);
  const top = -height / 2 + r;
  const curve = Array.from({ length: steps + 1 }, (_, i) => {
    const a = -Math.PI + (Math.PI * i) / steps;
    return [r * Math.cos(a) * (width / 2 / r), top + r * Math.sin(a)] as Point;
  });
  return [...curve.slice(steps / 2), [width / 2, height / 2], [-width / 2, height / 2], ...curve.slice(0, steps / 2)];
}

/** A regular polygon centred on 0,0 with a point at the top. */
export function polygon(sides: number, radius: number): Point[] {
  return circle(radius, Math.max(3, Math.round(sides)));
}

/** A polygon's bounding box. */
export function bounds(points: readonly Point[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return points.length ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
}

/** Triangle indices into `ring` (a closed outline, last point optionally repeating the first). */
export function triangulate(ring: readonly Point[]): number[] {
  const contour = ring.map(([x, y]) => new THREE.Vector2(x, y));
  return THREE.ShapeUtils.triangulateShape(contour, []).flat();
}

/**
 * A filled shape in the scene graph. `setPoints` re-triangulates a new outline; `movePoints` moves the same
 * points in place (morph, rigs), keeping the triangles. Recipe units in, y down.
 */
export class ShapeMesh extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  constructor(points: readonly Point[], color: THREE.ColorRepresentation = '#8B9CFF') {
    // Triangles keep their winding when points move or flip, so both faces draw.
    super(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide }),
    );
    this.setPoints(points);
  }

  setPoints(points: readonly Point[]): void {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3));
    this.geometry.setIndex(triangulate(points));
    this.movePoints(points);
  }

  /** Moves the outline without re-triangulating; false (nothing moved) when the point count differs. */
  movePoints(points: readonly Point[]): boolean {
    const position = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (points.length !== position.count) return false;
    points.forEach(([x, y], i) => position.setXYZ(i, x * UNIT, -y * UNIT, 0));
    position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
    return true;
  }
}
