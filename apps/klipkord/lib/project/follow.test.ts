import { describe, expect, it } from 'vitest';
import { followBox, followOverlays, scrollBetween } from './follow';
import type { Overlay, RecEvent } from './types';

const events: RecEvent[] = [
  { t: 500, type: 'scroll', dy: 0.5 },
  { t: 1500, type: 'scroll', dy: 0.1 },
  { t: 1600, type: 'move', x: 0.2, y: 0.2 },
  { t: 2000, type: 'scroll', dy: -0.04 },
  { t: 3000, type: 'page' },
  { t: 3500, type: 'scroll', dy: 0.3 },
];

const blur = (follow: boolean, at = 1000): Overlay => ({
  id: 'b', kind: 'blur', at, end: 9000, box: { x: 0.2, y: 0.5, w: 0.3, h: 0.1 }, motion: 'none', blur: { mode: 'blur', amount: 0.6, follow },
});

describe('follow the page', () => {
  it('adds the scroll after the start up to the time, and a new page ends it', () => {
    expect(scrollBetween(events, 1000, 1000)).toBe(0);
    expect(scrollBetween(events, 1000, 1500)).toBeCloseTo(0.1);
    expect(scrollBetween(events, 1000, 2500)).toBeCloseTo(0.06);
    expect(scrollBetween(events, 1000, 5000)).toBeCloseTo(0.06);
    expect(scrollBetween(events, 0, 600)).toBeCloseTo(0.5);
    expect(scrollBetween(events, 3200, 4000)).toBeCloseTo(0.3);
  });

  it('moves a following blur up as the page scrolls down, and back as it scrolls up', () => {
    expect(followBox(blur(true), events, 1500).y).toBeCloseTo(0.4);
    expect(followBox(blur(true), events, 2100).y).toBeCloseTo(0.44);
    expect(followBox(blur(true), events, 900).y).toBe(0.5);
  });

  it('leaves fixed blurs and other overlays alone', () => {
    const fixed = blur(false);
    expect(followBox(fixed, events, 2500)).toBe(fixed.box);
    const text: Overlay = { ...blur(true), kind: 'text', text: 'Hi' };
    expect(followBox(text, events, 2500)).toBe(text.box);
    const list = [fixed, text];
    expect(followOverlays(list, events, 2500)).toBe(list);
    expect(followOverlays(list, undefined, 2500)).toBe(list);
  });

  it('returns new overlays only for the ones that moved', () => {
    const moving = blur(true);
    const fixed = blur(false);
    const out = followOverlays([moving, fixed], events, 1500);
    expect(out[0]!.box.y).toBeCloseTo(0.4);
    expect(out[0]!.box.x).toBe(0.2);
    expect(out[1]).toBe(fixed);
    expect(moving.box.y).toBe(0.5);
  });
});
