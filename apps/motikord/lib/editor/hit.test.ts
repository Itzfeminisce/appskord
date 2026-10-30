import { describe, expect, it } from 'vitest';
import { dragBox, handleAt, hitLayer, pointInBox, sameBox } from './hit';

const W = 200;
const H = 400;
const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.25 }; // 100 x 100 px, centre (100, 150)

describe('hit testing', () => {
  it('finds points inside a box, also when it is turned', () => {
    expect(pointInBox(box, { x: 60, y: 110 }, W, H)).toBe(true);
    expect(pointInBox(box, { x: 40, y: 150 }, W, H)).toBe(false);
    const turned = { ...box, rotation: 45 };
    expect(pointInBox(turned, { x: 100, y: 150 - 65 }, W, H)).toBe(true);   // a corner now points up
    expect(pointInBox(turned, { x: 55, y: 105 }, W, H)).toBe(false);        // the old corner is outside
  });

  it('picks the topmost unlocked layer', () => {
    const layers = [
      { id: 'bottom', box: { x: 0, y: 0, w: 1, h: 1 } },
      { id: 'top', box },
      { id: 'locked', box, locked: true },
    ];
    expect(hitLayer(layers, (l) => l.box, { x: 100, y: 150 }, W, H)?.id).toBe('top');
    expect(hitLayer(layers, (l) => l.box, { x: 10, y: 10 }, W, H)?.id).toBe('bottom');
    expect(hitLayer(layers.slice(1), (l) => l.box, { x: 10, y: 10 }, W, H)).toBeUndefined();
  });

  it('tells corners, body, rotate ring and outside apart', () => {
    expect(handleAt(box, { x: 52, y: 102 }, W, H)).toBe('nw');
    expect(handleAt(box, { x: 150, y: 200 }, W, H)).toBe('se');
    expect(handleAt(box, { x: 100, y: 150 }, W, H)).toBe('move');
    expect(handleAt(box, { x: 165, y: 215 }, W, H)).toBe('rotate');
    expect(handleAt(box, { x: 10, y: 380 }, W, H)).toBeNull();
  });
});

describe('dragging', () => {
  it('moves by the pointer delta', () => {
    expect(dragBox(box, 'move', { x: 0, y: 0 }, { x: 20, y: -40 }, W, H)).toEqual({ x: 0.35, y: 0.15, w: 0.5, h: 0.25 });
  });

  it('resizes from a corner and holds the opposite corner', () => {
    const b = dragBox(box, 'se', { x: 150, y: 200 }, { x: 170, y: 240 }, W, H);
    expect(b).toEqual({ x: 0.25, y: 0.25, w: 0.6, h: 0.35 });
    const nw = dragBox(box, 'nw', { x: 50, y: 100 }, { x: 30, y: 100 }, W, H);
    expect(nw.x + nw.w).toBeCloseTo(0.75);
    expect(nw.w).toBeCloseTo(0.6);
  });

  it('keeps the ratio when asked and never goes below the minimum', () => {
    const b = dragBox(box, 'se', { x: 150, y: 200 }, { x: 250, y: 200 }, W, H, { keepRatio: true });
    expect(b.w * W).toBeCloseTo(b.h * H);
    const tiny = dragBox(box, 'se', { x: 150, y: 200 }, { x: -500, y: -500 }, W, H, { minPx: 10 });
    expect(tiny.w * W).toBeCloseTo(10);
  });

  it('finds the round Rotate knob above the top edge', () => {
    expect(handleAt(box, { x: 100, y: 100 - 25 }, W, H)).toBe('rotate');
    expect(handleAt(box, { x: 100, y: 100 - 50 }, W, H)).toBeNull();
  });

  it('lets a thin rule keep its height while its width is resized', () => {
    const rule = { x: 0.25, y: 0.5, w: 0.5, h: 0 };
    const out = dragBox(rule, 'se', { x: 150, y: 200 }, { x: 170, y: 200 }, W, H);
    expect(out.h).toBe(0);
    expect(out.w).toBeCloseTo(0.6);
    const thin = { x: 0.25, y: 0.5, w: 0.5, h: 2 / H };
    expect(dragBox(thin, 'se', { x: 150, y: 202 }, { x: 160, y: 202 }, W, H).h).toBeCloseTo(2 / H);
  });

  it('resizes a turned box along its own axes', () => {
    const turned = { ...box, rotation: 90 };
    // Turned 90°, the box's own x axis points down the canvas.
    const b = dragBox(turned, 'se', { x: 0, y: 0 }, { x: 0, y: 20 }, W, H);
    expect(b.w * W).toBeCloseTo(120);
    expect(b.h * H).toBeCloseTo(100);
  });

  it('rotates around the centre and snaps to 15°', () => {
    const r = dragBox(box, 'rotate', { x: 200, y: 150 }, { x: 100, y: 250 }, W, H);
    expect(r.rotation).toBeCloseTo(90);
    const s = dragBox(box, 'rotate', { x: 200, y: 150 }, { x: 200, y: 160 }, W, H, { snap: true });
    expect(s.rotation).toBe(0);
    expect(sameBox(box, { ...box, rotation: 0 })).toBe(true);
  });
});
