import { describe, expect, it } from 'vitest';
import type { Overlay, RenderPlan } from '../../project/types';
import { backgroundFill, FALLBACK_COLOUR, rgba } from './background';
import { CAPTION_MARGIN, layoutCaption, WORD_ON } from './captions';
import { clickRing } from './cursor';
import { box, containBox, coverCrop, gradientLine, intersect, motionAt, overlayBox, shadowOf, toCanvas } from './geometry';
import { layerOrder } from './order';

const overlay = (kind: Overlay['kind'], extra: Partial<Overlay> = {}): Overlay =>
  ({ id: kind, kind, at: 0, end: 1000, box: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, motion: 'none', ...extra });

function fullPlan(change: Partial<RenderPlan> = {}): RenderPlan {
  return {
    out: 500, rec: 500, fade: 0.3,
    background: { kind: 'colour', value: '#112233' },
    screen: { source: 'screen', t: 500, crop: { x: 0, y: 0, w: 1, h: 1 }, dest: { x: 48, y: 48, w: 1749, h: 984 }, radius: 16, shadow: 24 },
    camera: { source: 'camera', t: 500, dest: { x: 40, y: 651, w: 389, h: 389 }, shape: 'round', mirror: true, blur: { on: false, mode: 'blur', colour: '#1C1917' }, alpha: 1 },
    cursor: { x: 900, y: 500, size: 1, click: 0.5 },
    overlays: [overlay('text', { text: 'Hi' }), overlay('blur', { blur: { mode: 'pixelate', amount: 0.5, follow: false } })],
    cards: [{ id: 'c', template: 'title', at: 0, ms: 2000, slots: {}, pack: 'clean' }],
    captions: { words: [{ text: 'Click', on: true }, { text: 'Invite', on: true }, { text: 'now', on: false }], style: { style: 'word', position: 'bottom', size: 48, show: true } },
    media: { source: 'clip', t: 0 },
    ...change,
  };
}

describe('layerOrder', () => {
  it('stacks every layer bottom to top', () => {
    expect(layerOrder(fullPlan(), true)).toEqual(
      ['background', 'screen', 'media', 'privacy', 'overlays', 'cursor', 'camera', 'cards', 'captions', 'fade'],
    );
  });

  it('draws only the background in a gap, and cards only once a hook is set', () => {
    expect(layerOrder({ out: 0, rec: null, background: { kind: 'colour', value: '#000' }, overlays: [], cards: [], fade: 0 }, true)).toEqual(['background']);
    expect(layerOrder(fullPlan(), false)).not.toContain('cards');
  });

  it('needs the screen for overlays, since they sit on its picture', () => {
    const order = layerOrder(fullPlan({ screen: undefined, cursor: undefined }), true);
    expect(order).not.toContain('privacy');
    expect(order).not.toContain('overlays');
  });
});

describe('box maths', () => {
  it('scales frame px to canvas px', () => {
    expect(toCanvas({ x: 48, y: 48, w: 1824, h: 984 }, { x: 0.5, y: 0.5 }, box())).toEqual({ x: 24, y: 24, w: 912, h: 492 });
  });

  it('places an overlay through the zoom crop', () => {
    const screen = { crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, dest: { x: 100, y: 100, w: 800, h: 400 } };
    expect(overlayBox({ x: 0.5, y: 0.75, w: 0.25, h: 0.25 }, screen, box())).toEqual({ x: 100, y: 300, w: 400, h: 200 });
    expect(overlayBox({ x: 0, y: 0, w: 1, h: 1 }, { ...screen, crop: { x: 0, y: 0, w: 1, h: 1 } }, box())).toEqual(screen.dest);
  });

  it('crops to fill without bars and fits inside with bars', () => {
    expect(coverCrop({ w: 640, h: 480 }, { w: 100, h: 100 }, box())).toEqual({ x: 0.125, y: 0, w: 0.75, h: 1 });
    expect(coverCrop({ w: 1080, h: 1920 }, { w: 100, h: 100 }, box()).h).toBeCloseTo(1080 / 1920);
    expect(containBox({ w: 1920, h: 1080 }, { x: 0, y: 0, w: 1000, h: 1000 }, box())).toEqual({ x: 0, y: 218.75, w: 1000, h: 562.5 });
  });

  it('intersects boxes and reports no overlap', () => {
    const out = box();
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }, out)).toBe(true);
    expect(out).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }, out)).toBe(false);
  });

  it('runs a 135° gradient corner to corner of a square', () => {
    const line = gradientLine({ x: 0, y: 0, w: 100, h: 100 });
    expect(line.x0).toBeCloseTo(0);
    expect(line.y1).toBeCloseTo(100);
  });

  it('turns the look shadow into a CSS-like drop shadow and none at 0', () => {
    expect(shadowOf(30, { sigma: 0, dy: 0, alpha: 0 })).toEqual({ sigma: 15, dy: 12, alpha: 0.35 });
    expect(shadowOf(0, { sigma: 0, dy: 0, alpha: 0 }).alpha).toBe(0);
  });

  it('fades and pops overlays in and out, and never moves a "none" one', () => {
    expect(motionAt('fade', 0, 1000, 100)).toEqual({ alpha: 0.5, scale: 1 });
    expect(motionAt('pop', 0, 1000, 0).scale).toBeCloseTo(0.85);
    expect(motionAt('none', 0, 1000, 0)).toEqual({ alpha: 1, scale: 1 });
  });

  it('grows the click ring as it fades', () => {
    expect(clickRing(1, 36).alpha).toBeCloseTo(0.6);
    expect(clickRing(0, 36).radius).toBeGreaterThan(clickRing(1, 36).radius);
  });
});

describe('background', () => {
  it('falls back to a colour when a gradient or picture is missing', () => {
    expect(backgroundFill({ kind: 'gradient', value: 'ember' }, false)).toMatchObject({ kind: 'gradient' });
    expect(backgroundFill({ kind: 'gradient', value: 'nope' }, false)).toEqual({ kind: 'colour', colour: FALLBACK_COLOUR });
    expect(backgroundFill({ kind: 'blurred', value: '' }, false)).toEqual({ kind: 'colour', colour: FALLBACK_COLOUR });
    expect(backgroundFill({ kind: 'blurred', value: '' }, true)).toEqual({ kind: 'picture', blur: true });
  });

  it('parses hex and rgba colours', () => {
    expect(rgba('#FF0000')).toEqual([1, 0, 0, 1]);
    expect(rgba('#fff')).toEqual([1, 1, 1, 1]);
    expect(rgba('rgba(17,17,20,0.82)')).toEqual([17 / 255, 17 / 255, 20 / 255, 0.82]);
  });
});

describe('layoutCaption', () => {
  const measure = (text: string) => text.length * 10;
  const frame = { w: 1920, h: 1080 };
  const words = (n: number, on = 0) => Array.from({ length: n }, (_, i) => ({ text: 'word', on: i < on }));

  it('centres one line above the bottom safe margin', () => {
    const l = layoutCaption({ words: words(3), style: { style: 'clean', position: 'bottom', size: 48, show: true } }, frame, measure);
    expect(l.lines).toHaveLength(1);
    expect(l.w).toBe(140 + 64);
    expect(l.x).toBe((1920 - 204) / 2);
    expect(l.y + l.h).toBeCloseTo(1080 * (1 - CAPTION_MARGIN.bottom));
    expect(l.lines[0]!.words.map((w) => w.x)).toEqual([890, 940, 990]);
    expect(l.box).toBe('rgba(17,17,20,0.82)');
  });

  it('wraps long captions inside the frame width, top and middle too', () => {
    const style = { style: 'bold', position: 'top', size: 48, show: true } as const;
    const narrow = { w: 400, h: 800 };
    const l = layoutCaption({ words: words(12), style }, narrow, measure);
    expect(l.lines.length).toBeGreaterThan(1);
    for (const line of l.lines) for (const w of line.words) expect(w.x + w.w).toBeLessThanOrEqual(l.x + l.w + 0.01);
    expect(l.x).toBeGreaterThanOrEqual(0);
    expect(l.y).toBeCloseTo(800 * CAPTION_MARGIN.top);
    const mid = layoutCaption({ words: words(12), style: { ...style, position: 'middle' } }, narrow, measure);
    expect(mid.y + mid.h / 2).toBeCloseTo(400);
  });

  it('marks the spoken word only in "Word by word"', () => {
    const word = layoutCaption({ words: words(3, 2), style: { style: 'word', position: 'bottom', size: 48, show: true } }, frame, measure);
    expect(word.lines[0]!.words.map((w) => w.hot)).toEqual([false, true, false]);
    expect(WORD_ON).toBe('#FDBA74');
    const bold = layoutCaption({ words: words(3, 2), style: { style: 'bold', position: 'bottom', size: 48, show: true } }, frame, measure);
    expect(bold.lines[0]!.words.some((w) => w.hot)).toBe(false);
  });
});
