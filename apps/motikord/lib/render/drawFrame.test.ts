import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Layer, Recipe, Scene } from '../types';
import { MediaCache } from './cache';
import { activeLayers, clipDuration, drawFrame, sceneAt, type Ctx } from './drawFrame';

/** A 2D context stand-in that logs every call and property set, so drawing can be compared without a browser. */
function fakeCtx(width: number, height: number) {
  const log: string[] = [];
  let font = '10px sans-serif';
  const target: Record<string, unknown> = {
    canvas: { width, height },
    measureText: (s: string) => ({ width: s.length * Number(/([\d.]+)px/.exec(font)![1]) * 0.5 }),
  };
  const ctx = new Proxy(target, {
    get: (t, k) => (k in t ? t[k as string] : (...args: unknown[]) => { log.push(`${String(k)}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`); }),
    set: (_t, k, v) => { if (k === 'font') font = v; log.push(`${String(k)}=${v}`); return true; },
  });
  return { ctx: ctx as unknown as Ctx, log };
}

const text = (id: string, extra: Partial<Layer> = {}): Layer => ({
  id, name: id, type: 'text', role: 'title', text: 'Hello there', font: 'Geist', sizePx: 80, weight: 700, colour: '#FFFFFF',
  align: 'center', lineHeight: 1.2, startMs: 0, endMs: 1000, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1, ...extra,
} as Layer);
const scene = (id: string, background: string, layers: Layer[], durationMs = 1000): Scene => ({ id, durationMs, background, layout: 'center', layers });
const recipe = (scenes: Scene[]): Recipe => ({ version: 1, id: 'r', name: 'Test', type: 'promo', aspect: '16:9', scenes, assets: {} });

const clip = recipe([
  scene('a', '#111111', [text('t1', { startMs: 200, endMs: 1000 })]),
  scene('b', '#222222', [text('t2', { in: { preset: 'type-on', feel: 'steady', durationMs: 1000 } })]),
  scene('c', '#333333', [{ id: 's', name: 's', type: 'shape', shape: 'rect', fill: '#FF0000', startMs: 0, endMs: 1000, opacity: 1,
    box: { x: 0, y: 0, w: 0.5, h: 0.5 }, boxes: { '9:16': { x: 0.25, y: 0.25, w: 0.5, h: 0.25 } } }]),
]);

describe('timing', () => {
  it('finds the scene at each side of a boundary', () => {
    expect(clipDuration(clip)).toBe(3000);
    expect(sceneAt(clip, -5)).toMatchObject({ index: 0, localMs: 0 });
    expect(sceneAt(clip, 999)).toMatchObject({ index: 0, localMs: 999 });
    expect(sceneAt(clip, 1000)).toMatchObject({ index: 1, localMs: 0, startMs: 1000 });
    expect(sceneAt(clip, 2999)).toMatchObject({ index: 2, localMs: 999 });
    expect(sceneAt(clip, 5000)).toMatchObject({ index: 2, localMs: 1000 });
    expect(sceneAt(recipe([]), 0)).toBeUndefined();
  });

  it('a layer is on screen from its start up to, not including, its end', () => {
    const s = clip.scenes[0]!;
    expect(activeLayers(s, 199)).toHaveLength(0);
    expect(activeLayers(s, 200)).toHaveLength(1);
    expect(activeLayers(s, 1000)).toHaveLength(0);
  });
});

describe('drawFrame', () => {
  const draw = (t: number, aspect: Recipe['aspect'] = '16:9', seeThrough = false) => {
    const { ctx, log } = fakeCtx(1280, 720);
    drawFrame(ctx, clip, aspect, t, new MediaCache(), { seeThrough });
    return log;
  };

  it('gives the same calls for the same inputs', () => {
    expect(draw(1500)).toEqual(draw(1500));
  });

  it('draws the right scene on each side of a boundary', () => {
    expect(draw(999)).toContain('fillStyle=#111111');
    expect(draw(999).some((c) => c.startsWith('fillText(Hello there'))).toBe(true);
    expect(draw(1000)).toContain('fillStyle=#222222');
    expect(draw(100).some((c) => c.startsWith('fillText'))).toBe(false);
  });

  it('types on part of the text halfway through', () => {
    const typed = draw(1500).filter((c) => c.startsWith('fillText')).map((c) => c.slice(9).split(',')[0]).join('');
    expect(typed.length).toBe(5);
  });

  it('uses the per-size box for that size only', () => {
    expect(draw(2500, '9:16')).toContain('rect(-320.00,-90.00,640.00,180.00)');
    expect(draw(2500, '16:9')).toContain('rect(-320.00,-180.00,640.00,360.00)');
  });

  it('leaves the background clear when see-through', () => {
    expect(draw(500, '16:9', true)).not.toContain('fillStyle=#111111');
  });

  it('has no DOM access, so it runs in the export worker', () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/\b(document|window|HTML\w*Element)\b/);
    }
  });
});
