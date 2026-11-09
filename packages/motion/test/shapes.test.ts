import { describe, expect, it } from 'vitest';
import { maskPlanes, maskReveal, lineRise } from '../src/masks';
import { morpher } from '../src/morph';
import { drawDash, drawPoints, parsePath, pathLength, type Point } from '../src/paths';
import { bounds, circle, roundedRect } from '../src/shapes';
import * as THREE from 'three';
import { UNIT } from '../src/scene';

const MOTION_PATH = 'M14 58 C 30 58, 34 30, 52 32 S 74 56, 88 40 S 102 18, 110 16';

describe('paths and line-draw', () => {
  it('parses path data with curves and relative commands', () => {
    const [line] = parsePath(MOTION_PATH, 8);
    expect(line?.[0]).toEqual([14, 58]);
    expect(line?.at(-1)?.[0]).toBeCloseTo(110, 10);
    expect(line?.at(-1)?.[1]).toBeCloseTo(16, 10);
    expect(line).toHaveLength(25);
    expect(parsePath('m0 0 h10 v10 l-10 0 z')).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ]);
  });

  it('draws on by length', () => {
    const square: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(pathLength(square)).toBe(20);
    expect(drawPoints(square, 0)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(drawPoints(square, 0.25)).toEqual([
      [0, 0],
      [5, 0],
    ]);
    expect(drawPoints(square, 0.75)).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ]);
    expect(drawPoints(square, 1.2)).toEqual(square);
    expect(pathLength(drawPoints(parsePath(MOTION_PATH)[0]!, 0.5))).toBeCloseTo(
      pathLength(parsePath(MOTION_PATH)[0]!) / 2,
      6,
    );
  });

  it('writes the dash MotionV3 draws at 10, 50 and 100%', () => {
    expect([0.1, 0.5, 1].map(drawDash)).toEqual(['10 100', '50 100', '100 100']);
  });
});

describe('shapes and morph', () => {
  const from = roundedRect(52, 52, 26);
  const to = roundedRect(52, 52, 8, 45);

  it('builds rounded squares and circles', () => {
    expect(bounds(roundedRect(52, 40, 0))).toEqual({ x: -26, y: -20, width: 52, height: 40 });
    const b = bounds(circle(10, 4));
    expect(b.width).toBeCloseTo(20, 10);
  });

  it('ends exactly on the from and to shapes, and holds there past the ends', () => {
    const at = morpher(from, to);
    expect(at(0)).toEqual(from);
    expect(at(-0.2)).toEqual(from);
    expect(at(1)).toEqual(to);
    expect(at(1.3)).toEqual(to);
  });

  it('is deterministic between the ends', () => {
    const a = morpher(from, to)(0.5);
    const b = morpher(from, to)(0.5);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(3);
    const w = bounds(a).width;
    expect(w).toBeGreaterThan(40);
    expect(w).toBeLessThan(80);
  });
});

describe('mask reveal', () => {
  const box = { x: 10, y: 18, width: 96, height: 44 };

  it('uncovers from the left as drawn, with the edge on the moving line', () => {
    expect(maskReveal(box, 0)).toEqual({ visible: { x: 10, y: 18, width: 0, height: 44 }, edge: 10 });
    expect(maskReveal(box, 0.5)).toEqual({ visible: { x: 10, y: 18, width: 48, height: 44 }, edge: 58 });
    expect(maskReveal(box, 1.4).visible).toEqual(box);
  });

  it('uncovers from the other sides', () => {
    expect(maskReveal(box, 0.25, 'right')).toEqual({ visible: { x: 82, y: 18, width: 24, height: 44 }, edge: 82 });
    expect(maskReveal(box, 0.5, 'top').visible).toEqual({ x: 10, y: 18, width: 96, height: 22 });
    expect(maskReveal(box, 0.5, 'bottom').edge).toBe(40);
  });

  it('rises masked lines from one line height below', () => {
    expect([0, 0.5, 1, 2].map((p) => lineRise(p, 40))).toEqual([40, 20, 0, 0]);
  });

  it('clips with planes that keep only the visible box', () => {
    const planes = maskPlanes({ x: 0, y: 0, width: 540, height: 100 });
    const inside = new THREE.Vector3(270 * UNIT, -50 * UNIT, 0);
    const outside = new THREE.Vector3(600 * UNIT, -50 * UNIT, 0);
    expect(planes.every((p) => p.distanceToPoint(inside) >= 0)).toBe(true);
    expect(planes.some((p) => p.distanceToPoint(outside) < 0)).toBe(true);
  });
});
