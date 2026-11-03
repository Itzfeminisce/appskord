import { describe, expect, it } from 'vitest';
import { arrowPath, centreOn, fitAll, itemsInRect, lineUp, normalRect, topItemAt, worldRect } from './geometry';

const card = (id: string, x: number, y: number, w = 100, h = 80) => ({ id, rect: { x, y, w, h } });

describe('hit testing', () => {
  const items = [{ ...card('low', 0, 0, 200, 200), z: 1 }, { ...card('high', 100, 100, 200, 200), z: 5 }, { ...card('far', 1000, 1000), z: 9 }];

  it('picks the topmost item under a point', () => {
    expect(topItemAt(items, { x: 150, y: 150 })?.id).toBe('high');
    expect(topItemAt(items, { x: 50, y: 50 })?.id).toBe('low');
    expect(topItemAt(items, { x: 600, y: 600 })).toBeUndefined();
  });

  it('counts edges as inside', () => {
    expect(topItemAt(items, { x: 0, y: 0 })?.id).toBe('low');
  });

  it('selects every item a marquee touches, whichever way it was dragged', () => {
    expect(itemsInRect(items, { x: 260, y: 260, w: -40, h: -40 }).sort()).toEqual(['high']);
    expect(itemsInRect(items, { x: -10, y: -10, w: 2000, h: 2000 }).sort()).toEqual(['far', 'high', 'low']);
    expect(itemsInRect(items, { x: 400, y: 400, w: 100, h: 100 })).toEqual([]);
    expect(normalRect({ x: 10, y: 10, w: -5, h: -5 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });
});

describe('fitAll', () => {
  const size = { w: 1366, h: 588 };

  it('shows every card and never zooms past 100%', () => {
    const cam = fitAll([card('a', 0, 0, 200, 100).rect], size)!;
    expect(cam.zoom).toBe(1);
    // Centred: the card's centre lands in the middle of the screen.
    expect(100 * cam.zoom + cam.x).toBeCloseTo(size.w / 2);
    expect(50 * cam.zoom + cam.y).toBeCloseTo(size.h / 2);
  });

  it('zooms out to fit a wide board with padding', () => {
    const cam = fitAll([card('a', 0, 0).rect, card('b', 5900, 0).rect], size, 56)!;
    expect(cam.zoom).toBeCloseTo((1366 - 112) / 6000);
    const view = worldRect(cam, size);
    expect(view.x).toBeLessThan(0);
    expect(view.x + view.w).toBeGreaterThan(6000);
  });

  it('has nothing to fit on an empty board or an unmeasured screen', () => {
    expect(fitAll([], size)).toBeUndefined();
    expect(fitAll([card('a', 0, 0).rect], { w: 0, h: 0 })).toBeUndefined();
  });

  it('centres one card at a zoom', () => {
    expect(centreOn({ x: 100, y: 100, w: 200, h: 100 }, { w: 1000, h: 600 }, 2)).toEqual({ x: 100, y: 0, zoom: 2 });
  });
});

describe('arrowPath and lineUp', () => {
  it('draws straight between cards in a row and curves otherwise', () => {
    expect(arrowPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 0, w: 100, h: 100 })).toBe('M100 50 L300 50');
    expect(arrowPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 300, y: 200, w: 100, h: 100 })).toBe('M100 50 C200 50 200 250 300 250');
    expect(arrowPath({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 300, w: 100, h: 100 })).toBe('M50 100 L50 300');
  });

  it('lines cards up in one row from the leftmost', () => {
    expect(lineUp([{ x: 50, y: 40, w: 100, h: 50 }, { x: 0, y: 10, w: 80, h: 60 }], 20)).toEqual([
      { x: 0, y: 10, w: 100, h: 50 },
      { x: 120, y: 10, w: 80, h: 60 },
    ]);
  });
});
