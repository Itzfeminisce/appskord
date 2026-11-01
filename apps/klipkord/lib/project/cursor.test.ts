import { describe, expect, it } from 'vitest';
import { CLICK_MS, clickAt, CONVERGE_MS, CURSOR_SETTLE_MS, cursorAt, smoothAt } from './cursor';
import type { RecEvent } from './types';

describe('smooth cursor', () => {
  it('steadies hand shake instead of copying each jump', () => {
    const shaky: RecEvent[] = [];
    for (let t = 0; t <= 2000; t += 33) shaky.push({ t, type: 'move', x: 0.5 + (t % 66 ? 0.01 : -0.01), y: 0.5 });
    for (let t = 1000; t < 2000; t += 7) {
      expect(Math.abs(smoothAt(shaky, t)!.x - 0.5)).toBeLessThan(0.006);
      expect(Math.abs(cursorAt(shaky, t, false)!.x - 0.5)).toBeCloseTo(0.01);
    }
  });

  it('glides to a new spot and settles there, never overshooting', () => {
    const events: RecEvent[] = [{ t: 0, type: 'move', x: 0.1, y: 0.1 }, { t: 1000, type: 'move', x: 0.9, y: 0.6 }];
    let prev = 0.1;
    for (let t = 1000; t <= 1000 + CURSOR_SETTLE_MS; t += 5) {
      const { x } = smoothAt(events, t)!;
      expect(x).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(x).toBeLessThanOrEqual(0.9);
      prev = x;
    }
    expect(smoothAt(events, 1000 + CURSOR_SETTLE_MS)!.x).toBeCloseTo(0.9, 2);
    expect(smoothAt(events, 3000)).toEqual({ x: expect.closeTo(0.9, 6), y: expect.closeTo(0.6, 6) });
  });

  it('reads the same at any frame time: resampled, not stepped', () => {
    const events: RecEvent[] = [];
    for (let t = 0; t <= 1000; t += 33) events.push({ t, type: 'move', x: t / 1000, y: 0.5 });
    const a = smoothAt(events, 600)!.x;
    const b = smoothAt(events, 616)!.x;
    const c = smoothAt(events, 633)!.x;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c - b).toBeCloseTo(b - a, 2);
  });

  it('rings a click and fades it over CLICK_MS', () => {
    const events: RecEvent[] = [{ t: 0, type: 'move', x: 0.2, y: 0.2 }, { t: 100, type: 'click', x: 0.2, y: 0.2 }, { t: 150, type: 'key', key: 'typing' }];
    expect(clickAt(events, 99)).toBe(0);
    expect(clickAt(events, 100)).toBe(1);
    expect(clickAt(events, 100 + CLICK_MS / 2)).toBe(0.5);
    expect(clickAt(events, 100 + CLICK_MS)).toBe(0);
    expect(cursorAt(events, 100, true)).toMatchObject({ click: 1 });
  });

  it('has no cursor before the first move', () => {
    expect(cursorAt([{ t: 50, type: 'page' }], 100, true)).toBeNull();
    expect(cursorAt([{ t: 50, type: 'move', x: 0, y: 0 }], 10, true)).toBeNull();
  });

  it('lands the smooth cursor on the click, and rings the clicked spot', () => {
    // A 0.3-wide sweep over 200 ms, then a click 100 ms after the last move.
    const events: RecEvent[] = [{ t: 0, type: 'move', x: 0.2, y: 0.4 }];
    for (let t = 1000; t <= 1200; t += 40) events.push({ t, type: 'move', x: 0.2 + (0.3 * (t - 1000)) / 200, y: 0.4 });
    events.push({ t: 1300, type: 'click', x: 0.5, y: 0.4 });
    expect(smoothAt(events, 1300)!.x).toBeLessThan(0.499);
    expect(cursorAt(events, 1300, true)).toMatchObject({ x: 0.5, y: 0.4, click: 1, ring: { x: 0.5, y: 0.4 } });
    expect(cursorAt(events, 1300 - CONVERGE_MS - 1, true)!.x).toBe(smoothAt(events, 1300 - CONVERGE_MS - 1)!.x);
    expect(cursorAt(events, 1700, true)!.ring).toEqual({ x: 0.5, y: 0.4 });
  });
});
