import { describe, expect, it } from 'vitest';
import { arrowLine, boundsOf, fitCamera, visibleCards, worldRect, zoomAt } from './geometry';

const card = (id: string, x: number, y: number, w = 100, h = 80) => ({ id, rect: { x, y, w, h } });

describe('visibleCards', () => {
  const cards = [card('in', 50, 50), card('edge', 990, 10), card('right', 1100, 0), card('below', 0, 900), card('around', -500, -500, 3000, 3000)];
  const viewport = { x: 0, y: 0, w: 1000, h: 800 };

  it('keeps cards that touch the viewport and drops the rest', () => {
    expect([...visibleCards(cards, viewport, 1)].sort()).toEqual(['around', 'edge', 'in']);
  });

  it('grows the viewport by the margin in screen pixels', () => {
    expect([...visibleCards(cards, viewport, 1, 150)].sort()).toEqual(['around', 'below', 'edge', 'in', 'right']);
    // At zoom 2 the same margin covers half the canvas units.
    expect(visibleCards(cards, viewport, 2, 150).has('right')).toBe(false);
    expect(visibleCards(cards, viewport, 2, 220).has('right')).toBe(true);
  });

  it('treats a card that only shares an edge as out of view', () => {
    expect(visibleCards([card('touch', 1000, 0)], viewport, 1).size).toBe(0);
  });

  it('works with the camera world rect', () => {
    const view = worldRect({ x: -1000, y: 0, zoom: 1 }, { w: 500, h: 500 });
    expect([...visibleCards(cards, view, 1)].sort()).toEqual(['around', 'edge', 'right']);
  });
});

describe('camera', () => {
  it('zooms around the pointer', () => {
    const next = zoomAt({ x: 0, y: 0, zoom: 1 }, { x: 100, y: 50 }, 2);
    expect(next).toEqual({ x: -100, y: -50, zoom: 2 });
    expect(zoomAt(next, { x: 0, y: 0 }, 100).zoom).toBe(4);
  });

  it('fits bounds into the screen', () => {
    const cam = fitCamera({ x: 0, y: 0, w: 2000, h: 1000 }, { w: 1080, h: 1000 }, 40);
    expect(cam.zoom).toBe(0.5);
    expect(worldRect(cam, { w: 1080, h: 1000 }).x).toBe(-80);
  });

  it('measures bounds', () => {
    expect(boundsOf([card('a', 0, 0).rect, card('b', 200, 300).rect])).toEqual({ x: 0, y: 0, w: 300, h: 380 });
    expect(boundsOf([])).toBeUndefined();
  });
});

describe('arrowLine', () => {
  it('runs between the facing edges', () => {
    expect(arrowLine({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 0, w: 100, h: 100 })).toEqual({ from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
  });
});
