import { describe, expect, it } from 'vitest';
import { creditsList, creditsText, endCardEdit, endCardLines, needsCreditsFile } from './credits';
import { bundledAsset, BUNDLED_TRACKS } from './music';
import { applyPatch } from './patch';
import type { Asset, Recipe } from './types';

const loaf: Asset = { id: 'a', kind: 'image', name: 'Loaf', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/a.jpg', credit: { title: 'Loaf on a wooden board', author: 'Ada', source: 'openverse', url: 'https://www.flickr.com/photos/a', licence: 'cc-by', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/' } };
const baker: Asset = { id: 'b', kind: 'video', name: 'Baker', mime: 'video/mp4', bytes: 1, opfsPath: 'media/b.mp4', credit: { title: 'Video by Bo', author: 'Bo', source: 'pexels', url: 'https://www.pexels.com/video/9/', licence: 'pexels' } };
const mine: Asset = { id: 'c', kind: 'image', name: 'sourdough-loaf.jpg', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/c.jpg' };
const sunny = bundledAsset(BUNDLED_TRACKS[0]!);
const layer = (id: string, assetId: string, type: 'image' | 'video') => ({ id, name: id, type, assetId, fit: 'cover' as const, startMs: 0, endMs: 5000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } });
const recipe = (): Recipe => ({
  version: 1, id: 'r', name: 'Sourdough promo', type: 'promo', aspect: '9:16',
  assets: { a: loaf, b: baker, c: mine, [sunny.id]: sunny, unused: { ...loaf, id: 'unused' } },
  music: { assetId: sunny.id, volume: 0.7, fadeInMs: 500, fadeOutMs: 1000 },
  scenes: [{ id: 's', durationMs: 5000, background: '#fff', layout: 'x', layers: [layer('l1', 'a', 'image'), layer('l2', 'b', 'video'), layer('l3', 'c', 'image')] }],
});

describe('credits', () => {
  it('marks CC BY as needed, others optional, own media not listed, and skips unused assets', () => {
    const { credited, own } = creditsList(recipe());
    expect(credited.map((c) => [c.asset.id, c.need])).toEqual([['a', 'needed'], ['b', 'optional'], [sunny.id, 'optional']]);
    expect(own.map((a) => a.name)).toEqual(['sourdough-loaf.jpg']);
    expect(needsCreditsFile(recipe())).toBe(true);
  });
  it('writes credits.txt for CC BY, Pexels and bundled music', () => {
    expect(creditsText(recipe())).toBe([
      'Sourdough promo · made with Motikord',
      '“Loaf on a wooden board” by Ada\nOpenverse · CC BY 4.0\nhttps://www.flickr.com/photos/a\nhttps://creativecommons.org/licenses/by/4.0/',
      '“Video by Bo” by Bo\nPexels · Pexels licence\nhttps://www.pexels.com/video/9/',
      '“Sunny morning” · Motikord · CC0',
    ].join('\n\n'));
  });
  it('leaves out "by" when the author is unknown and names BY-NC-SA exactly', () => {
    const odd: Asset = { ...loaf, credit: { ...loaf.credit!, author: 'Unknown', licence: 'cc-by-nc', licenceUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' } };
    const r = { ...recipe(), assets: { ...recipe().assets, a: odd } };
    expect(creditsText(r)).toContain('“Loaf on a wooden board”\nOpenverse · CC BY-NC-SA 4.0\nhttps://www.flickr.com/photos/a\nhttps://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(endCardLines(r)[0]).toBe('Photo: “Loaf on a wooden board”, CC BY-NC-SA 4.0');
  });
  it('writes the end card lines', () => {
    expect(endCardLines(recipe())).toEqual(['Photo: “Loaf on a wooden board” by Ada, CC BY 4.0', 'Video: Bo, Pexels', 'Music: Sunny morning, CC0']);
  });
  it('toggles the end card', () => {
    let r = recipe();
    r = applyPatch(r, endCardEdit(r, true)!.ops).doc;
    expect(r.creditsEndCard).toBe(true);
    expect(endCardEdit(r, true)).toBeUndefined();
    r = applyPatch(r, endCardEdit(r, false)!.ops).doc;
    expect(r.creditsEndCard).toBe(false);
  });
  it('lists a web page picture as optional, two credits.txt lines, and never forces credits.txt', () => {
    const page: Asset = { id: 'p', kind: 'image', name: 'Bakery', mime: 'image/jpeg', bytes: 1, opfsPath: 'media/p.jpg', credit: { title: 'Bakery counter', author: 'Bakery Site', source: 'page', url: 'https://bakery.example/counter', licence: 'page' } };
    const r = recipe();
    r.assets = { p: page };
    r.scenes[0]!.layers = [layer('lp', 'p', 'image')];
    expect(creditsList(r).credited.map((c) => [c.asset.id, c.need, c.licence])).toEqual([['p', 'optional', 'Web page']]);
    expect(needsCreditsFile(r)).toBe(false);
    expect(creditsText(r)).toBe('Sourdough promo · made with Motikord\n\n“Bakery counter” · From Bakery Site\nhttps://bakery.example/counter');
  });
  it('needs no credits file without CC BY', () => {
    const r = recipe();
    r.scenes[0]!.layers.splice(0, 1);
    expect(needsCreditsFile(r)).toBe(false);
  });
});
