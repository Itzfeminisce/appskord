import { describe, expect, it } from 'vitest';
import type { Aspect, Box } from '../types';
import { LAYOUTS, boxFor, canvasSize, clampToSafe, insideSafe, isLayoutId, reflowBox, safeBox } from './reflow';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const pairs = ASPECTS.flatMap((a) => ASPECTS.filter((b) => b !== a).map((b) => [a, b] as const));
const title: Box = { x: 0.1, y: 0.4, w: 0.8, h: 0.15 };
const badge: Box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };

describe('reflow', () => {
  it('canvas sizes put the short side at 720 or 1080', () => {
    expect(canvasSize('9:16', 720)).toEqual({ w: 720, h: 1280 });
    expect(canvasSize('1:1', 1080)).toEqual({ w: 1080, h: 1080 });
    expect(canvasSize('16:9', 720)).toEqual({ w: 1280, h: 720 });
  });

  it.each(pairs)('%s to %s keeps every box inside the safe area', (from, to) => {
    for (const b of [title, badge, { x: 0, y: 0, w: 0.5, h: 0.3 }, { x: 0.7, y: 0.8, w: 0.3, h: 0.2 }]) {
      for (const keepShape of [false, true]) expect(insideSafe(reflowBox(b, from, to, { keepShape }), to)).toBe(true);
    }
  });

  it.each(pairs)('%s to %s keeps boxes that did not overlap apart', (from, to) => {
    const row = [0, 1, 2, 3].map((i) => ({ x: 0.1 + i * 0.2, y: 0.1 + i * 0.2, w: 0.18, h: 0.18 }));
    for (const keepShape of [false, true]) {
      const out = row.map((b) => reflowBox(b, from, to, { keepShape }));
      for (let i = 1; i < out.length; i++) expect(out[i]!.x).toBeGreaterThanOrEqual(out[i - 1]!.x + out[i - 1]!.w - 1e-3);
    }
  });

  it.each(pairs)('%s to %s keeps a circle or picture the same shape on screen', (from, to) => {
    const r = reflowBox(badge, from, to, { keepShape: true });
    const px = (b: Box, a: Aspect) => { const s = canvasSize(a, 1080); return (b.w * s.w) / (b.h * s.h); };
    expect(px(r, to)).toBeCloseTo(px(badge, from), 2);
  });

  it('leaves full-bleed backgrounds and same-size boxes alone', () => {
    const bg = { x: 0, y: 0, w: 1, h: 1 };
    expect(reflowBox(bg, '16:9', '9:16')).toEqual(bg);
    expect(reflowBox(badge, '1:1', '1:1')).toEqual(badge);
  });

  it('a split layout stacks halves when going from wide to tall', () => {
    const left = reflowBox({ x: 0.05, y: 0.3, w: 0.4, h: 0.4 }, '16:9', '9:16', { layout: 'split' });
    const right = reflowBox({ x: 0.55, y: 0.3, w: 0.4, h: 0.4 }, '16:9', '9:16', { layout: 'split' });
    expect(left.y).toBeLessThan(right.y);
  });

  it('keeps rotation and clamps a box that pokes out', () => {
    const c = clampToSafe({ x: -0.1, y: 0.9, w: 0.3, h: 0.2, rotation: 5 }, '1:1');
    expect(insideSafe(c, '1:1')).toBe(true);
    expect(c.rotation).toBe(5);
  });

  it('a "This size only" box wins over the main box', () => {
    const own: Box = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
    const layer = { type: 'shape' as const, box: badge, boxes: { '9:16': own } };
    expect(boxFor(layer, '9:16', '16:9')).toBe(own);
    expect(boxFor(layer, '16:9', '16:9')).toBe(badge);
    expect(boxFor(layer, '1:1', '16:9')).toEqual(reflowBox(badge, '16:9', '1:1'));
    expect(boxFor({ ...layer, type: 'image' }, '1:1', '16:9')).toEqual(reflowBox(badge, '16:9', '1:1', { keepShape: true }));
  });

  it('layout ids are a small fixed set', () => {
    expect(LAYOUTS.length).toBeLessThanOrEqual(8);
    expect(isLayoutId('split')).toBe(true);
    expect(isLayoutId('freeform')).toBe(false);
  });
});
