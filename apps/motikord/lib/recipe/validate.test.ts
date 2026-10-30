import { describe, expect, it } from 'vitest';
import type { Recipe } from '../types';
import { isRecipe, validateRecipe } from './validate';

function goodRecipe(): Recipe {
  return {
    version: 1, id: 'clip-1', name: 'Spring sale', type: 'promo', aspect: '9:16',
    assets: {
      photo: { id: 'photo', kind: 'image', name: 'Shoes', mime: 'image/jpeg', bytes: 1200, width: 800, height: 600, opfsPath: 'media/photo.jpg',
        credit: { title: 'Shoes', author: 'A. Person', source: 'openverse', url: 'https://example.test/p', licence: 'cc-by' } },
      song: { id: 'song', kind: 'audio', name: 'Calm', mime: 'audio/mpeg', bytes: 5000, durationMs: 30000, opfsPath: 'media/song.mp3' },
    },
    scenes: [{
      id: 's1', durationMs: 4000, background: '#111114', layout: 'title-center',
      layers: [
        { id: 'l1', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 96, weight: 700, colour: '#FFFFFF',
          align: 'center', lineHeight: 1.1, startMs: 0, endMs: 4000, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1,
          in: { preset: 'rise', feel: 'smooth', durationMs: 500 }, boxes: { '16:9': { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } },
        { id: 'l2', name: 'Photo', type: 'image', assetId: 'photo', fit: 'cover', startMs: 0, endMs: 3000, box: { x: 0, y: 0, w: 1, h: 0.4 }, opacity: 1 },
        { id: 'l3', name: 'Bar', type: 'shape', shape: 'rect', fill: '#BE185D', radius: 8, startMs: 500, endMs: 4000, box: { x: 0.1, y: 0.7, w: 0.8, h: 0.02 }, opacity: 0.8 },
        { id: 'l4', name: 'Chart', type: 'chart', chart: 'bar', values: [{ label: 'Q1', value: 3 }], colour: '#BE185D', startMs: 0, endMs: 1000, box: { x: 0.1, y: 0.75, w: 0.8, h: 0.2 }, opacity: 1 },
      ],
    }],
    music: { assetId: 'song', volume: 0.6, fadeInMs: 0, fadeOutMs: 800 },
  };
}

describe('validateRecipe', () => {
  it('accepts a good recipe', () => {
    expect(validateRecipe(goodRecipe())).toEqual([]);
    expect(isRecipe(goodRecipe())).toBe(true);
  });

  it('accepts a transparent background for see-through clips', () => {
    const r = goodRecipe();
    r.scenes[0]!.background = 'transparent';
    expect(validateRecipe(r)).toEqual([]);
  });

  it('rejects things that are not recipes', () => {
    expect(validateRecipe(null)).toEqual(['The recipe is not an object.']);
    expect(validateRecipe({}).length).toBeGreaterThan(3);
  });

  const cases: [string, (r: Recipe) => void, RegExp][] = [
    ['wrong version', (r) => { (r as { version: number }).version = 2; }, /version must be 1/],
    ['unknown clip type', (r) => { (r as { type: string }).type = 'meme'; }, /clip type must be one of/],
    ['unknown aspect', (r) => { (r as { aspect: string }).aspect = '4:3'; }, /size must be one of/],
    ['no scenes', (r) => { r.scenes = []; }, /at least one scene/],
    ['layer ends before it starts', (r) => { r.scenes[0]!.layers[0]!.endMs = 0; }, /layer "Title" must end after it starts/],
    ['layer ends after its scene', (r) => { r.scenes[0]!.layers[0]!.endMs = 5000; }, /ends after its scene/],
    ['box outside the canvas', (r) => { r.scenes[0]!.layers[0]!.box.x = 2.5; }, /x must be a fraction/],
    ['no size', (r) => { const b = r.scenes[0]!.layers[0]!.box; b.w = 0; b.h = 0; }, /must have a width or a height/],
    ['bad per-size box', (r) => { r.scenes[0]!.layers[0]!.boxes = { '4:3': { x: 0, y: 0, w: 1, h: 1 } } as never; }, /unknown size "4:3"/],
    ['bad colour', (r) => { (r.scenes[0]!.layers[0] as { colour: string }).colour = 'pink'; }, /colour must be a hex colour/],
    ['bad feel', (r) => { r.scenes[0]!.layers[0]!.in = { preset: 'rise', feel: 'wobbly' as never, durationMs: 500 }; }, /"Comes in" feel must be one of/],
    ['missing asset', (r) => { (r.scenes[0]!.layers[1] as { assetId: string }).assetId = 'nope'; }, /not in the assets list/],
    ['image layer on an audio file', (r) => { (r.scenes[0]!.layers[1] as { assetId: string }).assetId = 'song'; }, /audio file, not a image/],
    ['duplicate layer id', (r) => { r.scenes[0]!.layers[1]!.id = 'l1'; }, /uses the id "l1" twice/],
    ['opacity above 1', (r) => { r.scenes[0]!.layers[2]!.opacity = 2; }, /opacity must be between 0 and 1/],
    ['empty chart', (r) => { (r.scenes[0]!.layers[3] as { values: unknown[] }).values = []; }, /at least one value/],
    ['asset key and id differ', (r) => { r.assets.photo!.id = 'other'; }, /must have the id "photo"/],
    ['bad licence', (r) => { r.assets.photo!.credit!.licence = 'mine' as never; }, /licence must be one of/],
    ['music on an image', (r) => { r.music!.assetId = 'photo'; }, /Music must point to an audio file/],
    ['clip longer than 60 seconds', (r) => { r.scenes[0]!.durationMs = 61000; }, /the most is 60/],
  ];
  for (const [name, breakIt, problem] of cases) {
    it(`rejects ${name}`, () => {
      const r = goodRecipe();
      breakIt(r);
      const problems = validateRecipe(r);
      expect(problems.some((p) => problem.test(p)), problems.join('\n')).toBe(true);
    });
  }
});
