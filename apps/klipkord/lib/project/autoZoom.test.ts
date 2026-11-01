import { describe, expect, it } from 'vitest';
import { rampMs } from '../render/spring';
import { autoZoom, depthFor, HOLD_MS, MAX_DEPTH, MIN_DEPTH, TYPING_DEPTH } from './autoZoom';
import type { RecEvent } from './types';

const click = (t: number, x: number, y: number): RecEvent => ({ t, type: 'click', x, y });

describe('autoZoom', () => {
  it('groups clicks close in time and place into one zoom, eased in before and out after', () => {
    const [z, ...rest] = autoZoom([click(5000, 0.3, 0.3), click(5400, 0.32, 0.31), click(5900, 0.31, 0.33)]);
    expect(rest).toEqual([]);
    const ramp = rampMs(z!.depth, 'smooth');
    expect(z).toMatchObject({ at: 5000 - ramp, end: 5900 + HOLD_MS + ramp, auto: true, feel: 'smooth', why: '3 clicks' });
    expect(z!.focus).toEqual({ x: expect.closeTo(0.31), y: expect.closeTo(0.315) });
  });

  it('splits on a long pause, a far spot, a scroll or a new page', () => {
    expect(autoZoom([click(0, 0.2, 0.2), click(9000, 0.2, 0.2)]).map((z) => z.why)).toEqual(['Click', 'Click']);
    const far = autoZoom([click(1000, 0.1, 0.1), click(1500, 0.9, 0.9)]);
    expect(far).toHaveLength(2);
    expect(far[0]!.end).toBe(far[1]!.at);
    expect(far[0]!.end).toBe(1250);
    expect(autoZoom([click(1000, 0.2, 0.2), { t: 1100, type: 'scroll', dy: 0.3 }, click(1200, 0.2, 0.2)])).toHaveLength(2);
    expect(autoZoom([click(1000, 0.2, 0.2), { t: 1100, type: 'page' }, click(1200, 0.2, 0.2)])).toHaveLength(2);
  });

  it('joins zooms that would run into each other on the same spot', () => {
    expect(autoZoom([click(1000, 0.5, 0.5), click(3000, 0.5, 0.5)])).toMatchObject([{ why: '2 clicks' }]);
  });

  it('zooms on typing at the last cursor spot, and ignores shortcuts', () => {
    const zooms = autoZoom([
      { t: 0, type: 'move', x: 0.6, y: 0.4 },
      { t: 2000, type: 'key', key: 'typing' }, { t: 2100, type: 'key', key: 'typing' },
      { t: 9000, type: 'key', key: 'Ctrl+C' },
    ]);
    expect(zooms).toHaveLength(1);
    expect(zooms[0]).toMatchObject({ why: 'Typing', depth: TYPING_DEPTH, focus: { x: 0.6, y: 0.4 } });
    expect(autoZoom([{ t: 0, type: 'key', key: 'typing' }])).toEqual([]);
  });

  it('picks a depth that fits the area', () => {
    expect(depthFor({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, false)).toBe(MAX_DEPTH);
    expect(depthFor({ x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.3 }, false)).toBe(1.4);
    expect(depthFor({ x0: 0, y0: 0, x1: 0.9, y1: 0.9 }, false)).toBe(MIN_DEPTH);
    expect(depthFor({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }, true)).toBe(TYPING_DEPTH);
  });

  it('stays inside the recording and never overlaps', () => {
    const events: RecEvent[] = [];
    for (let i = 0; i < 36; i++) events.push(click(200 + i * 700, (i * 0.37) % 1, (i * 0.61) % 1));
    const zooms = autoZoom(events, 'calm', 26_000);
    expect(zooms[0]!.at).toBe(0);
    expect(zooms.at(-1)!.end).toBe(26_000);
    for (const [i, z] of zooms.entries()) {
      expect(z.end).toBeGreaterThan(z.at);
      expect(z.end).toBeLessThanOrEqual(26_000);
      if (i) expect(z.at).toBeGreaterThanOrEqual(zooms[i - 1]!.end);
    }
    expect(new Set(zooms.map((z) => z.id)).size).toBe(zooms.length);
  });
});
