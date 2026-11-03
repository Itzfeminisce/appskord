import { describe, expect, it } from 'vitest';
import type { Diagram } from '../board/types';
import { DIAGRAM_ZOOM, fitView, fitZoom, openView, toDiagram, wheelZoom, WHEEL_STEP, zoomTo } from './zoom';

const box = (w: number, h: number): Diagram => ({ nodes: [{ id: 'a', kind: 'step', label: 'A', colour: 'white', x: 10, y: 20, w, h }], edges: [] });
const area = { w: 1200, h: 528 };

describe('diagram zoom', () => {
  it('zooms one mouse wheel notch by about 12%, and a pinch step by a little', () => {
    expect(wheelZoom(-100)).toBeCloseTo(WHEEL_STEP);
    expect(wheelZoom(100)).toBeCloseTo(1 / WHEEL_STEP);
    expect(wheelZoom(-48)).toBeCloseTo(WHEEL_STEP);
    expect(wheelZoom(-2)).toBeCloseTo(Math.exp(0.02));
    expect(wheelZoom(0)).toBe(1);
  });

  it('fits a big diagram below 100% and opens there', () => {
    const d = box(3000, 1200);
    expect(fitZoom(d, area)).toBeLessThan(1);
    expect(openView(d, area).zoom).toBeCloseTo(fitZoom(d, area));
  });

  it('opens a small diagram at 100%, while Fit zooms it in', () => {
    const d = box(200, 60);
    expect(openView(d, area).zoom).toBe(1);
    expect(fitView(d, area).zoom).toBeGreaterThan(1);
  });

  it('keeps zoom between 25% and 400%', () => {
    expect(fitZoom(box(100000, 100000), area)).toBe(DIAGRAM_ZOOM.min);
    expect(fitZoom(box(2, 2), area)).toBe(DIAGRAM_ZOOM.max);
    expect(zoomTo({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 9).zoom).toBe(4);
    expect(zoomTo({ x: 0, y: 0, zoom: 1 }, { x: 0, y: 0 }, 0.1).zoom).toBe(0.25);
  });

  it('zooms around the pointer: the diagram point under it stays put', () => {
    const v = { x: 40, y: -30, zoom: 1.2 };
    const at = { x: 500, y: 260 };
    const before = toDiagram(v, at);
    const after = toDiagram(zoomTo(v, at, 2.5), at);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('centres the fitted diagram in the area', () => {
    const d = box(600, 200);
    const v = fitView(d, area);
    const left = v.x + 10 * v.zoom, right = v.x + 610 * v.zoom;
    expect(left).toBeCloseTo(area.w - right);
  });
});
