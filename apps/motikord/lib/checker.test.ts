import { describe, expect, it } from 'vitest';
import { check, contrastRatio, readMs } from './checker';
import { applyPatch } from './patch';
import type { Layer, Recipe } from './types';

// Every character is half the type size wide.
const measure = (t: string, s: number) => t.length * s * 0.5;

const title = (extra: Partial<Layer> = {}): Layer => ({
  id: 'title', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 80, weight: 700,
  colour: '#FFFFFF', align: 'center', lineHeight: 1.2, startMs: 0, endMs: 3000, opacity: 1,
  box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 }, ...extra,
} as Layer);

const clip = (layers: Layer[], extra: Partial<Recipe> = {}): Recipe => ({
  version: 1, id: 'r', name: 'Clip', type: 'promo', aspect: '1:1',
  scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers }],
  assets: {
    photo: { id: 'photo', kind: 'image', name: 'p', mime: 'image/jpeg', bytes: 1, opfsPath: 'p',
      credit: { title: 'Hill', author: 'A. Person', source: 'openverse', url: 'https://example.org/p', licence: 'cc-by' } },
  },
  ...extra,
});

const fixed = (r: Recipe) => check(r, { measure }).reduce((doc, issue) => applyPatch(doc, issue.fix).doc as Recipe, r);
const kinds = (r: Recipe) => check(r, { measure }).map((i) => `${i.kind}@${i.aspect}`);

describe('checker', () => {
  it('passes a clean clip on every size', () => {
    expect(check(clip([title()]), { measure })).toEqual([]);
  });

  it('finds text that overflows and fixes it by fitting the size', () => {
    const r = clip([title({ text: 'A much longer spring sale headline than fits' } as Partial<Layer>)]);
    expect(kinds(r)).toContain('overflow@1:1');
    expect(kinds(fixed(r)).filter((k) => k.startsWith('overflow'))).toEqual([]);
  });

  it('finds low contrast against the scene or a card behind, and picks a readable colour', () => {
    const r = clip([title({ colour: '#222222' } as Partial<Layer>)]);
    expect(kinds(r)).toEqual(['contrast@1:1']);
    expect((fixed(r).scenes[0]!.layers[0] as { colour: string }).colour).toBe('#FFFFFF');
    const card: Layer = { id: 'card', name: 'Card', type: 'shape', shape: 'rect', fill: '#FFFFFF', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 } };
    expect(kinds(clip([card, title()]))).toEqual(['contrast@1:1']);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21);
  });

  it('finds content outside the safe area on each size and fixes that size only', () => {
    const r = clip([title({ boxes: { '9:16': { x: 0.2, y: 0.02, w: 0.6, h: 0.1 } } } as Partial<Layer>)]);
    expect(kinds(r)).toEqual(['safe-area@9:16']);
    const f = fixed(r);
    expect(kinds(f)).toEqual([]);
    expect(f.scenes[0]!.layers[0]!.box).toEqual(r.scenes[0]!.layers[0]!.box);
    const edge = clip([title({ box: { x: 0, y: 0.4, w: 0.6, h: 0.2 } })]);
    expect(kinds(edge)).toEqual(['safe-area@1:1']);
    expect(kinds(fixed(edge))).toEqual([]);
  });

  it('finds text on screen too briefly to read, and motion faster than the slider allows', () => {
    const r = clip([title({ endMs: 500, in: { preset: 'rise-in', feel: 'smooth', durationMs: 50 } })]);
    expect(kinds(r)).toEqual(['too-fast@1:1']);
    const f = fixed(r);
    expect(f.scenes[0]!.layers[0]!.endMs).toBe(readMs('Spring sale'));
    expect(f.scenes[0]!.layers[0]!.in!.durationMs).toBe(600);
    const long = clip([title({ text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', sizePx: 20, endMs: 1000 } as Partial<Layer>)]);
    const g = fixed(long);
    expect(g.scenes[0]!.durationMs).toBeGreaterThan(4000);
    expect(kinds(g)).toEqual([]);
  });

  it('flags CC BY media and music without credits, and turns the credits card on', () => {
    const photo: Layer = { id: 'ph', name: 'Photo', type: 'image', assetId: 'photo', fit: 'cover', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } };
    const r = clip([photo]);
    expect(kinds(r)).toEqual(['credit-missing@1:1']);
    expect(fixed(r).creditsEndCard).toBe(true);
    expect(kinds(clip([photo], { creditsEndCard: true }))).toEqual([]);
    const music = clip([], {
      music: { assetId: 'song', volume: 1, fadeInMs: 0, fadeOutMs: 0 },
      assets: { song: { id: 'song', kind: 'audio', name: 's', mime: 'audio/mpeg', bytes: 1, opfsPath: 's', credit: { title: 'S', author: 'B', source: 'openverse', url: 'https://example.org/s', licence: 'cc-by-sa' } } },
    });
    expect(kinds(music)).toEqual(['credit-missing@1:1']);
  });

  it('gives every issue a unique id', () => {
    const r = clip([title({ colour: '#222222', endMs: 300, box: { x: 0, y: 0, w: 0.3, h: 0.05 } })]);
    const ids = check(r, { measure }).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(3);
  });

  it('one overflow fix size holds on every size when all fixes are applied', () => {
    const r = clip([title({ text: 'A much longer spring sale headline than fits in any box at all', box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } as Partial<Layer>)]);
    const found = check(r, { measure }).filter((i) => i.kind === 'overflow');
    expect(found.length).toBeGreaterThan(1);
    expect(new Set(found.map((i) => JSON.stringify(i.fix))).size).toBe(1);
    expect(kinds(fixed(r)).filter((k) => k.startsWith('overflow'))).toEqual([]);
  });

  it('several too-fast fixes in one scene never cut a layer', () => {
    const words = (n: number) => Array.from({ length: n }, (_, k) => `w${k}`).join(' ');
    const a = title({ id: 'a', text: words(20), startMs: 1000, endMs: 1500, box: { x: 0.2, y: 0.2, w: 0.6, h: 0.2 } } as Partial<Layer>);
    const b = title({ id: 'b', text: words(12), startMs: 1500, endMs: 2000, box: { x: 0.2, y: 0.6, w: 0.6, h: 0.2 } } as Partial<Layer>);
    const f = fixed(clip([a, b]));
    const sc = f.scenes[0]!;
    expect(sc.durationMs).toBe(1000 + readMs(words(20)));
    for (const l of sc.layers) expect(l.endMs).toBeLessThanOrEqual(sc.durationMs);
    expect(kinds(f).filter((k) => k.startsWith('too-fast'))).toEqual([]);
  });

  it('reads the box for the recipe size and blends alpha and opacity when finding the colour behind', () => {
    const card = (extra: Partial<Layer>): Layer => ({ id: 'card', name: 'Card', type: 'shape', shape: 'rect', fill: '#FFFFFF', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 }, ...extra } as Layer);
    const ink = { colour: '#000000' } as Partial<Layer>;
    const moved = title({ box: { x: 0.02, y: 0.02, w: 0.1, h: 0.1 }, boxes: { '1:1': { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } } as Partial<Layer>);
    expect(kinds(clip([card({}), moved]))).toContain('contrast@1:1');
    expect(kinds(clip([card({}), title(ink)]))).toEqual([]);
    expect(kinds(clip([card({ fill: '#FFFFFF10' } as Partial<Layer>), title(ink)]))).toEqual(['contrast@1:1']);
    expect(kinds(clip([card({ opacity: 0.1 }), title(ink)]))).toEqual(['contrast@1:1']);
  });

  it('flags text under 28 px on 9:16, and the fix raises it without overflowing any size', () => {
    const small = clip([title({ text: 'Open daily', sizePx: 18, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } as Partial<Layer>)]);
    expect(kinds(small)).toContain('too-small@9:16');
    expect(kinds(fixed(small)).filter((k) => k.startsWith('too-small') || k.startsWith('overflow'))).toEqual([]);
    expect(kinds(clip([title({ sizePx: 40 } as Partial<Layer>)])).filter((k) => k.startsWith('too-small'))).toEqual([]);
  });

  it('does not flag small text that could not be 28 px without overflowing', () => {
    const tiny = clip([title({ text: 'Small print '.repeat(12).trim(), sizePx: 12, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.03 } } as Partial<Layer>)]);
    expect(kinds(tiny).filter((k) => k.startsWith('too-small'))).toEqual([]);
  });
});
