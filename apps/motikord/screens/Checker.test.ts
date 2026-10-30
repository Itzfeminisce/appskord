import { describe, expect, it } from 'vitest';
import { check } from '../lib/checker';
import { initState, reducer } from '../lib/editor/store';
import { applyPatch } from '../lib/patch';
import type { Clip, Layer, Recipe } from '../lib/types';
import { cardText, groupIssues, mergeFixes } from './Checker';

const measure = (t: string, s: number) => t.length * s * 0.5;
const text = (extra: Partial<Layer> = {}): Layer => ({
  id: 't', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 80, weight: 700,
  colour: '#FFFFFF', align: 'center', lineHeight: 1.2, startMs: 0, endMs: 3000, opacity: 1, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 }, ...extra,
} as Layer);
const clip = (layers: Layer[], extra: Partial<Recipe> = {}): Recipe => ({
  version: 1, id: 'r', name: 'Clip', type: 'promo', aspect: '1:1', assets: {
    photo: { id: 'photo', kind: 'image', name: 'p', mime: 'image/jpeg', bytes: 1, opfsPath: 'p', credit: { title: 'Hill', author: 'A. Person', source: 'openverse', url: 'https://example.org', licence: 'cc-by' } },
  },
  scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers }], ...extra,
});
const photo = (): Layer => ({ id: 'p', name: 'Photo', type: 'image', assetId: 'photo', fit: 'cover', startMs: 0, endMs: 4000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } });

const cases: [string, Layer[], string][] = [
  ['overflow', [text({ text: 'Spring sale on running shoes this weekend only for everyone' })], 'overflow'],
  ['contrast', [text({ colour: '#222226' })], 'contrast'],
  ['safe-area', [text({ box: { x: 0.0, y: 0.4, w: 0.6, h: 0.2 } })], 'safe-area'],
  ['too-fast', [text({ endMs: 400 })], 'too-fast'],
  ['credit-missing', [photo()], 'credit-missing'],
];

const cards = (r: Recipe) => groupIssues(check(r, { measure }));

describe('Checker cards', () => {
  it.each(cases)('%s: the failing recipe has a card and fixing it removes the kind', (_n, layers, kind) => {
    const r = clip(layers);
    const found = cards(r).filter((c) => c.kind === kind);
    expect(found.length).toBeGreaterThan(0);
    const out = applyPatch(r, found[0]!.fix).doc;
    expect(cards(out).filter((c) => c.kind === kind && c.layerId === found[0]!.layerId)).toEqual([]);
    expect(cardText(found[0]!, r).title).not.toBe('');
  });

  it('a clean recipe has no cards', () => {
    expect(cards(clip([text()]))).toEqual([]);
  });

  it('one card says all sizes when the same fix holds on every size', () => {
    const c = cards(clip([text({ text: 'Spring sale on running shoes this weekend only for everyone' })])).find((x) => x.kind === 'overflow')!;
    expect(c.aspects).toEqual(['9:16', '1:1', '16:9']);
    expect(cardText(c, clip([])).where).toContain('all sizes');
  });
});

describe('Fix all', () => {
  const messy = () => clip([
    text({ id: 'a', text: 'Spring sale on running shoes this weekend only for everyone' }),
    text({ id: 'b', colour: '#222226', box: { x: 0, y: 0.7, w: 0.5, h: 0.1 } }),
    text({ id: 'c', endMs: 400, box: { x: 0.2, y: 0.2, w: 0.6, h: 0.1 } }),
    photo(),
  ]);

  it('is one Change that empties the list, and one undo restores the clip', () => {
    const r = messy();
    const all = cards(r);
    expect(all.length).toBeGreaterThan(2);
    const c: Clip = { id: 'c', recipe: r, history: [], createdAt: 0, updatedAt: 0 };
    const s0 = initState(c);
    const s1 = reducer(s0, { type: 'edit', edit: { ops: mergeFixes(all), summary: `Fixed ${all.length} things` }, by: 'hand', at: 1, id: 'x' });
    expect(s1.clip.history).toHaveLength(1);
    expect(s1.clip.history[0]!.by).toBe('hand');
    expect(check(s1.clip.recipe, { measure })).toEqual([]);
    const s2 = reducer(s1, { type: 'undo', at: 2 });
    expect(s2.clip.recipe).toEqual(r);
  });

  it('joins per-size boxes added to one layer', () => {
    const r = clip([text({ box: { x: 0, y: 0.0, w: 0.9, h: 0.2 } })]);
    const out = applyPatch(r, mergeFixes(cards(r))).doc;
    expect(check(out, { measure }).filter((i) => i.kind === 'safe-area')).toEqual([]);
  });
});
