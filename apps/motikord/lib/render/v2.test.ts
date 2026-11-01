import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Background, Layer, Recipe, Scene, TransitionKind } from '../types';
import { MediaCache } from './cache';
import { countUp, drawFrame, inkOn, kenBurnsScale, sceneAt, type Ctx } from './drawFrame';
import { transitionShots } from './transitions';
import { MOTION_TOKENS } from './tokens';

/** A logging 2D context stand-in whose gradient and pattern factories return usable objects. */
function fakeCtx(width = 1280, height = 720) {
  const log: string[] = [];
  let font = '10px sans-serif';
  const paint = (name: string) => (...args: unknown[]) => { log.push(`${name}(${args.filter((a) => typeof a === 'number').map((a) => (a as number).toFixed(2)).join(',')})`); return { kind: name, addColorStop: (o: number, c: string) => log.push(`stop(${o.toFixed(2)},${c})`) }; };
  const target: Record<string, unknown> = {
    canvas: { width, height },
    measureText: (s: string) => ({ width: s.length * Number(/([\d.]+)px/.exec(font)![1]) * 0.5 }),
    createLinearGradient: paint('createLinearGradient'),
    createRadialGradient: paint('createRadialGradient'),
    createPattern: paint('createPattern'),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : (...args: unknown[]) => { log.push(`${String(k)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`); }),
    set: (_t, k, v) => { if (k === 'font') font = v; log.push(`${String(k)}=${typeof v === 'object' ? v.kind : v}`); return true; },
  });
  return { ctx: ctx as unknown as Ctx, log };
}

class FakeOffscreen {
  constructor(public width: number, public height: number) { FakeOffscreen.made++; }
  static made = 0;
  static log: string[] = [];
  getContext() { const f = fakeCtx(this.width, this.height); FakeOffscreen.log = f.log; return f.ctx; }
}

const text = (extra: Partial<Layer> = {}): Layer => ({
  id: 't', name: 't', type: 'text', role: 'title', text: 'one two three four', font: 'Inter', sizePx: 60, weight: 700, colour: '#0F172A',
  align: 'center', lineHeight: 1.2, startMs: 0, endMs: 3000, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1, ...extra,
} as Layer);
const image = (extra: Partial<Layer> = {}): Layer => ({
  id: 'm', name: 'm', type: 'image', assetId: 'pic', fit: 'cover', startMs: 0, endMs: 3000, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, opacity: 1, ...extra,
} as Layer);
const scene = (id: string, background: string, layers: Layer[] = [], extra: Partial<Scene> = {}): Scene => ({ id, durationMs: 3000, background, layout: 'center', layers, ...extra });
const recipe = (scenes: Scene[], extra: Partial<Recipe> = {}): Recipe => ({ version: 2, id: 'r', name: 'T', type: 'promo', aspect: '16:9', scenes, assets: {}, ...extra });
const draw = (r: Recipe, t: number, cache = new MediaCache()) => { const { ctx, log } = fakeCtx(); drawFrame(ctx, r, '16:9', t, cache); return log; };

beforeEach(() => { vi.stubGlobal('OffscreenCanvas', FakeOffscreen); FakeOffscreen.made = 0; });
afterEach(() => vi.unstubAllGlobals());

describe('backgrounds', () => {
  const bgOf = (bg: Background, t = 0, cache?: MediaCache) => draw(recipe([scene('a', '#123456', [], { bg })]), t, cache);

  it('solid fills with its colour, not scene.background', () => {
    const log = bgOf({ kind: 'solid', colours: ['#0A0A0A'] });
    expect(log.slice(log.indexOf('fillStyle=#0A0A0A'))[1]).toBe('fillRect(0.00,0.00,1280.00,720.00)');
    expect(log).not.toContain('fillStyle=#123456');
  });

  it('falls back to scene.background without bg', () => {
    expect(draw(recipe([scene('a', '#123456')]), 0)).toContain('fillStyle=#123456');
  });

  it('gradient runs top to bottom at 180 degrees', () => {
    const log = bgOf({ kind: 'gradient', colours: ['#FFFFFF', '#F1F5F9'], angle: 180 });
    expect(log.find((c) => c.startsWith('createLinearGradient'))).toMatch(/^createLinearGradient\(640.00,-?0.00,640.00,720.00\)$/);
    expect(log.indexOf('stop(0.00,#FFFFFF)')).toBeLessThan(log.indexOf('stop(1.00,#F1F5F9)'));
    expect(log).toContain('fillStyle=createLinearGradient');
  });

  it('blobs paint one soft radial per accent colour over the base, once, on a quarter-size layer', () => {
    const cache = new MediaCache();
    const bg: Background = { kind: 'blobs', colours: ['#FFF7ED', '#FDBA74', '#5EEAD4'], drift: true };
    const log = bgOf(bg, 0, cache);
    const off = FakeOffscreen.log;
    expect(off[0]).toBe('scale(0.25,0.25)');
    expect(off.indexOf('fillStyle=#FFF7ED')).toBeLessThan(off.indexOf('fillStyle=createRadialGradient'));
    expect(off.filter((c) => c.startsWith('createRadialGradient'))).toHaveLength(2);
    expect(off).toContain('stop(1.00,rgba(253,186,116,0))');
    expect(log.filter((c) => c.startsWith('drawImage'))).toHaveLength(1);
    const later = bgOf(bg, 4000, cache);
    expect(FakeOffscreen.made).toBe(1);
    expect(later.find((c) => c.startsWith('drawImage'))).not.toBe(log.find((c) => c.startsWith('drawImage')));
  });

  it('blobs draw straight onto the frame where OffscreenCanvas does not exist', () => {
    vi.unstubAllGlobals();
    const log = bgOf({ kind: 'blobs', colours: ['#FFF7ED', '#FDBA74'] });
    expect(log.indexOf('fillStyle=#FFF7ED')).toBeLessThan(log.indexOf('fillStyle=createRadialGradient'));
  });

  it('blocks fill full-bleed slabs in the accent', () => {
    const log = bgOf({ kind: 'blocks', colours: ['#0A0A0A', '#FACC15'] });
    const i = log.indexOf('fillStyle=#FACC15');
    expect(log.slice(i, i + 7)).toEqual(['fillStyle=#FACC15', 'beginPath()', 'moveTo(0.00,504.00)', 'lineTo(1280.00,432.00)', 'lineTo(1280.00,720.00)', 'lineTo(0.00,720.00)', 'closePath()']);
  });

  it('grain lays a cached seeded tile over the gradient, and shimmers with time', () => {
    const cache = new MediaCache();
    const bg: Background = { kind: 'grain', colours: ['#17406B', '#0F2A4A', '#0B2038'], grain: 0.08 };
    const a = bgOf(bg, 0, cache);
    const b = bgOf(bg, 500, cache);
    expect(a.indexOf('fillStyle=createLinearGradient')).toBeLessThan(a.indexOf('fillStyle=createPattern'));
    expect(a).toContain('globalAlpha=0.2');
    expect(FakeOffscreen.made).toBe(1);
    expect(b.filter((c) => c.startsWith('create'))).toEqual([]);
    expect(a.findLast((c) => c.startsWith('translate'))).not.toBe(b.findLast((c) => c.startsWith('translate')));
  });

  it('drift moves the background slowly and is the same for the same time', () => {
    const bg: Background = { kind: 'gradient', colours: ['#FFFFFF', '#000000'], drift: true };
    const tr = (t: number) => bgOf(bg, t).find((c) => c.startsWith('translate'));
    expect(tr(1000)).not.toBe(tr(0));
    expect(tr(1000)).toBe(tr(1000));
  });
});

describe('transitions', () => {
  const into = (kind: TransitionKind, ms = 400) => recipe([scene('a', '#111111'), scene('b', '#222222', [], { transition: { kind, ms } })]);
  const mid = (kind: TransitionKind) => draw(into(kind), 3200);

  it('keeps scene timing the same', () => {
    expect(sceneAt(into('crossfade'), 3000)).toMatchObject({ index: 1, localMs: 0 });
  });

  it.each(['crossfade', 'slide', 'push', 'wipe', 'zoom'] as const)('%s draws the outgoing scene, then the incoming one', (kind) => {
    const log = mid(kind);
    expect(log.indexOf('fillStyle=#111111')).toBeGreaterThan(-1);
    expect(log.indexOf('fillStyle=#111111')).toBeLessThan(log.indexOf('fillStyle=#222222'));
  });

  it.each(['cut', 'match'] as const)('%s draws only the incoming scene', (kind) => {
    const log = mid(kind);
    expect(log).not.toContain('fillStyle=#111111');
    expect(log).toContain('fillStyle=#222222');
  });

  it('shapes each kind as specified', () => {
    expect(mid('push').filter((c) => c.startsWith('setTransform')).length).toBe(3);
    expect(mid('wipe')).toContain('clip()');
    expect(mid('crossfade').some((c) => /^globalAlpha=0\.\d+/.test(c))).toBe(true);
    expect(transitionShots('push', 0.25)).toMatchObject({ out: { dx: -0.25 }, in: { dx: 0.75 } });
    expect(transitionShots('slide', 1).in.dx).toBe(0);
  });

  it('ends on the incoming scene alone', () => {
    expect(draw(into('crossfade'), 3400)).not.toContain('fillStyle=#111111');
  });

  it('pack tokens are the renderer card values', () => {
    expect(Object.values(MOTION_TOKENS).map((t) => `${t.name} ${t.ms}`)).toEqual(['ease-out 400', 'overshoot 250', 'bouncy 450', 'steady 500']);
  });
});

describe('type styling', () => {
  const words = (layer: Layer, t: number) => draw(recipe([scene('a', '#FFFFFF', [layer])]), t).filter((c) => c.startsWith('fillText')).map((c) => c.slice(9).split(',')[0]);
  const fadeIn = { preset: 'fade-in', feel: 'steady' as const, durationMs: 400 };

  it('word stagger starts each word 60 ms after the last', () => {
    const l = text({ stagger: 'word', in: fadeIn });
    expect(words(l, 0)).toEqual([]);
    expect(words(l, 60)).toEqual(['one']);
    expect(words(l, 120)).toEqual(['one', 'two']);
    expect(words(l, 181)).toEqual(['one', 'two', 'three', 'four']);
    expect(words(l, 2000)).toHaveLength(4);
  });

  it('line stagger starts each line 120 ms after the last', () => {
    const l = text({ stagger: 'line', in: fadeIn, text: 'first line here second line here', box: { x: 0.4, y: 0.3, w: 0.2, h: 0.4 } });
    const at = (t: number) => draw(recipe([scene('a', '#FFFFFF', [l])]), t).filter((c) => c.startsWith('fillText')).length;
    const all = at(2000);
    expect(all).toBeGreaterThan(3);
    expect(at(61)).toBeLessThan(at(121 + 120));
    expect(at(121 + 120 * 10)).toBe(all);
  });

  it('wipes an accent block in behind the highlight word after it lands', () => {
    const l = text({ highlight: { word: 1, colour: '#FACC15' }, in: fadeIn, letterSpacing: -0.02, shadow: true });
    const before = draw(recipe([scene('a', '#FFFFFF', [l])]), 300);
    const after = draw(recipe([scene('a', '#FFFFFF', [l])]), 1000);
    expect(before).not.toContain('fillStyle=#FACC15');
    const i = after.indexOf('fillStyle=#FACC15');
    expect(after[i + 2]).toMatch(/^roundRect/);
    expect(after.slice(i).find((c) => c.startsWith('fillText'))).toMatch(/^fillText\(two,/);
    expect(after).toContain(`fillStyle=${inkOn('#FACC15')}`);
    expect(after.some((c) => /^letterSpacing=-\d/.test(c))).toBe(true);
    expect(after).toContain('shadowColor=rgba(0,0,0,0.35)');
  });

  it('counts the Stat reveal number up from 0 over its in motion', () => {
    const l = text({ slot: 'number', text: '1,200+', in: { preset: 'grow-in', feel: 'steady', durationMs: 1000 } });
    const shown = (t: number) => draw(recipe([scene('a', '#FFFFFF', [l], { template: 'stat-reveal' })]), t).find((c) => c.startsWith('fillText'))!.slice(9).split(',').slice(0, -2).join(',');
    expect(shown(1)).toBe('1+');
    expect(shown(500)).toBe('600+');
    expect(shown(1000)).toBe('1,200+');
    expect(countUp('3.5x faster', 0.5)).toBe('1.8x faster');
    expect(countUp('No number', 0.3)).toBe('No number');
  });
});

describe('media styling', () => {
  const cache = () => { const c = new MediaCache(); c.setImage('pic', { width: 800, height: 600 } as unknown as ImageBitmap); return c; };

  it('Ken Burns scales from 1 at the start to 1.14 at the end', () => {
    expect(kenBurnsScale(0, 3000)).toBe(1);
    expect(kenBurnsScale(3000, 3000)).toBeCloseTo(1.14);
    const l = image({ kenBurns: true, during: { preset: 'slow-zoom', feel: 'smooth', durationMs: 2000 } });
    const late = draw(recipe([scene('a', '#000000', [l])]), 2999, cache());
    expect(late).toContain('scale(1.14,1.14)');
    expect(late.filter((c) => c.startsWith('scale('))).toHaveLength(1);
  });

  it('clips to a circle, a blob or rounded corners and strokes the border', () => {
    const at = (extra: Partial<Layer>) => draw(recipe([scene('a', '#000000', [image(extra)])]), 100, cache());
    expect(at({ mask: 'circle' })).toContain('ellipse(0.00,0.00,180.00,180.00,0.00,0.00,6.28)');
    expect(at({ mask: 'blob' }).filter((c) => c.startsWith('quadraticCurveTo'))).toHaveLength(8);
    const r = at({ mask: 'rounded', border: '#FFFFFF' });
    expect(r.indexOf('clip()')).toBeLessThan(r.findIndex((c) => c.startsWith('drawImage')));
    expect(r.slice(r.findIndex((c) => c.startsWith('drawImage')))).toEqual(expect.arrayContaining(['strokeStyle=#FFFFFF', 'stroke()']));
  });
});

describe('frame cost', () => {
  it('60 frames with grain, blobs and a transition create each gradient, pattern, tile and blob layer once', () => {
    const r = recipe([
      scene('a', '#000000', [text()], { bg: { kind: 'blobs', colours: ['#FFF7ED', '#FDBA74', '#5EEAD4'], drift: true, grain: 0.1 } }),
      scene('b', '#000000', [text({ stagger: 'word', in: { preset: 'rise-in', feel: 'smooth', durationMs: 400 } })],
        { bg: { kind: 'grain', colours: ['#17406B', '#0B2038'], grain: 0.08 }, transition: { kind: 'crossfade', ms: 600 } }),
    ]);
    const cache = new MediaCache();
    const { ctx, log } = fakeCtx(1920, 1080);
    for (let i = 0; i < 60; i++) drawFrame(ctx, r, '16:9', 2600 + (i * 1000) / 30, cache);
    expect(log.filter((c) => c.startsWith('createLinearGradient'))).toHaveLength(1);
    expect(log.filter((c) => c.startsWith('createPattern'))).toHaveLength(1);
    expect(FakeOffscreen.made).toBe(2);
  });
});
