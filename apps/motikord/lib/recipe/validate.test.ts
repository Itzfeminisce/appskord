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
      id: 's1', durationMs: 4000, background: '#111114', layout: 'center',
      layers: [
        { id: 'l1', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 96, weight: 700, colour: '#FFFFFF',
          align: 'center', lineHeight: 1.1, startMs: 0, endMs: 4000, box: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, opacity: 1,
          in: { preset: 'rise-in', feel: 'smooth', durationMs: 500 }, boxes: { '16:9': { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } },
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
    ['wrong version', (r) => { (r as { version: number }).version = 3; }, /version must be 1 or 2/],
    ['unknown clip type', (r) => { (r as { type: string }).type = 'meme'; }, /clip type must be one of/],
    ['unknown aspect', (r) => { (r as { aspect: string }).aspect = '4:3'; }, /size must be one of/],
    ['no scenes', (r) => { r.scenes = []; }, /at least one scene/],
    ['layer ends before it starts', (r) => { r.scenes[0]!.layers[0]!.endMs = 0; }, /layer "Title" must end after it starts/],
    ['layer ends after its scene', (r) => { r.scenes[0]!.layers[0]!.endMs = 5000; }, /ends after its scene/],
    ['box outside the canvas', (r) => { r.scenes[0]!.layers[0]!.box.x = 2.5; }, /x must be a fraction/],
    ['no size', (r) => { const b = r.scenes[0]!.layers[0]!.box; b.w = 0; b.h = 0; }, /must have a width or a height/],
    ['bad per-size box', (r) => { r.scenes[0]!.layers[0]!.boxes = { '4:3': { x: 0, y: 0, w: 1, h: 1 } } as never; }, /unknown size "4:3"/],
    ['bad colour', (r) => { (r.scenes[0]!.layers[0] as { colour: string }).colour = 'pink'; }, /colour must be a hex colour/],
    ['bad feel', (r) => { r.scenes[0]!.layers[0]!.in = { preset: 'rise-in', feel: 'wobbly' as never, durationMs: 500 }; }, /"Comes in" feel must be one of/],
    ['missing asset', (r) => { (r.scenes[0]!.layers[1] as { assetId: string }).assetId = 'nope'; }, /not in the assets list/],
    ['image layer on an audio file', (r) => { (r.scenes[0]!.layers[1] as { assetId: string }).assetId = 'song'; }, /audio file, not a image/],
    ['duplicate layer id', (r) => { r.scenes[0]!.layers[1]!.id = 'l1'; }, /uses the id "l1" twice/],
    ['opacity above 1', (r) => { r.scenes[0]!.layers[2]!.opacity = 2; }, /opacity must be between 0 and 1/],
    ['empty chart', (r) => { (r.scenes[0]!.layers[3] as { values: unknown[] }).values = []; }, /at least one value/],
    ['asset key and id differ', (r) => { r.assets.photo!.id = 'other'; }, /must have the id "photo"/],
    ['bad licence', (r) => { r.assets.photo!.credit!.licence = 'mine' as never; }, /licence must be one of/],
    ['music on an image', (r) => { r.music!.assetId = 'photo'; }, /Music must point to an audio file/],
    ['unknown layout', (r) => { r.scenes[0]!.layout = 'title-center'; }, /layout must be one of center/],
    ['unknown preset', (r) => { r.scenes[0]!.layers[0]!.in = { preset: 'zoom', feel: 'smooth', durationMs: 500 }; }, /preset "zoom" is not a known in preset/],
    ['preset in the wrong slot', (r) => { r.scenes[0]!.layers[0]!.out = { preset: 'fade-in', feel: 'smooth', durationMs: 500 }; }, /"Goes out" preset "fade-in" is not a known out preset/],
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

describe('validateRecipe v2 fields', () => {
  function v2(): Recipe {
    const r = goodRecipe();
    r.version = 2;
    Object.assign(r, { style: 'bold', pace: 'fast', mood: 'none', beatSync: true, beats: [0, 500, 1000] });
    Object.assign(r.scenes[0]!, {
      template: 'title-hook', slots: { kicker: 'New at Rise', headline: 'Fresh sourdough', background: { assetId: 'photo' } },
      original: { headline: 'Fresh sourdough baked here every single morning' },
      transition: { kind: 'push', ms: 250 }, bg: { kind: 'grain', colours: ['#0F2A4A'], grain: 0.1, drift: true },
    });
    Object.assign(r.scenes[0]!.layers[0]!, { letterSpacing: -0.03, highlight: { word: 1, colour: '#FACC15' }, shadow: true, stagger: 'word', slot: 'headline' });
    Object.assign(r.scenes[0]!.layers[1]!, { radius: 12, mask: 'rounded', border: '#FFFFFF', kenBurns: true, slot: 'background' });
    return r;
  }

  it('accepts a v2 recipe and an AI image credit', () => {
    const r = v2();
    r.assets.photo!.credit = { title: 'Loaf', author: 'OpenAI', source: 'ai', url: '', licence: 'ai' };
    expect(validateRecipe(r)).toEqual([]);
  });

  const cases: [string, (r: Recipe) => void, RegExp][] = [
    ['an unknown template', (r) => { (r.scenes[0] as { template: string }).template = 'meme'; }, /template must be one of title-hook/],
    ['an unknown style', (r) => { (r as { style: string }).style = 'neon'; }, /style must be one of clean, bold/],
    ['an unknown transition', (r) => { r.scenes[0]!.transition = { kind: 'spin' as never, ms: 300 }; }, /transition must be one of cut/],
    ['a slot the template does not have', (r) => { r.scenes[0]!.slots!.price = '£4'; }, /slot "price" that Title hook does not have/],
    ['an unknown pace', (r) => { (r as { pace: string }).pace = 'slow'; }, /pace must be one of/],
    ['a bad background', (r) => { r.scenes[0]!.bg = { kind: 'gradient', colours: [] }; }, /needs one or more hex colours/],
    ['a bad highlight', (r) => { Object.assign(r.scenes[0]!.layers[0]!, { highlight: { word: -1, colour: 'red' } }); }, /highlight needs a word number/],
  ];
  for (const [name, breakIt, problem] of cases) {
    it(`rejects ${name}`, () => {
      const r = v2();
      breakIt(r);
      const problems = validateRecipe(r);
      expect(problems.some((p) => problem.test(p)), problems.join('\n')).toBe(true);
    });
  }
});
