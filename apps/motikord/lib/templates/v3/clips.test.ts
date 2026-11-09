import { describe, expect, it } from 'vitest';
import { validateClip } from '@appskord/motion/recipe';
import { makeFromTemplateV3 } from '../../makeClip';
import type { Clip } from '../../types';
import { autoCaptionsOf, clipTemplateRecipe, clipTemplateV3, CLIP_TEMPLATES_V3, sceneLengths } from './clips';

// FRAMES.md "v3 clip templates": name, filter type, pack, scenes, length in seconds.
const FRAMES: [string, string, string, string[], number][] = [
  ['Fieldnote launch', 'promo', 'studio', ['title-hook', 'hero', 'split', 'big-statement', 'end-card'], 18],
  ['Customer quote', 'quote', 'soft', ['quote', 'hero', 'end-card'], 12],
  ['Growth chart', 'chart', 'kinetic', ['big-statement', 'chart', 'stat-reveal', 'end-card'], 15],
  ['Logo pop', 'logo', 'gloss', ['logo-sting', 'end-card'], 6],
  ['How it works', 'explainer', 'clean', ['title-hook', 'steps', 'list', 'end-card'], 20],
  ['Morning shift drop', 'social', 'bold', ['big-statement', 'hero', 'end-card'], 10],
  ['Say it out loud', 'captions', 'kinetic', ['big-statement', 'big-statement', 'big-statement', 'end-card'], 15],
  ['Quarterly results', 'chart', 'corporate', ['title-hook', 'stat-reveal', 'chart', 'list', 'end-card'], 20],
  ['Glow up', 'promo', 'playful', ['before-after', 'big-statement', 'end-card'], 12],
  ['Three tips', 'explainer', 'bold', ['title-hook', 'list', 'split', 'big-statement', 'end-card'], 20],
  ['Weekend pop-up', 'social', 'soft', ['title-hook', 'hero', 'split', 'end-card'], 14],
  ['Brand story', 'logo', 'studio', ['big-statement', 'hero', 'logo-sting'], 10],
];

describe('v3 clip templates', () => {
  it('are the 12 in FRAMES.md, in frame order', () => {
    expect(CLIP_TEMPLATES_V3.map((t) => [t.name, t.type, t.packId, t.scenes, t.lengthMs / 1000])).toEqual(FRAMES);
    expect(new Set(CLIP_TEMPLATES_V3.map((t) => t.id)).size).toBe(12);
  });

  it.each(CLIP_TEMPLATES_V3.map((t) => [t.name, t] as const))('%s builds a valid v3 clip of its length', (_, t) => {
    const recipe = clipTemplateRecipe(t);
    const clip = clipTemplateV3(t, recipe);
    expect(validateClip(clip).ok).toBe(true);
    expect(clip.packId).toBe(t.packId);
    expect(clip.scenes.map((s) => s.templateId)).toEqual(t.scenes);
    expect(clip.scenes.reduce((n, s) => n + s.ms, 0)).toBe(t.lengthMs);
    expect(recipe.scenes.reduce((n, s) => n + s.durationMs, 0)).toBe(t.lengthMs);
    expect(sceneLengths(t).every((ms) => ms > 0)).toBe(true);
    // Every sample word fits its slot's limit: nothing was cut.
    expect(recipe.scenes.filter((s) => s.original)).toEqual([]);
  });

  it('is deterministic', () => {
    for (const t of CLIP_TEMPLATES_V3) expect(clipTemplateV3(t)).toEqual(clipTemplateV3(t));
  });

  it('only Say it out loud turns on Word pop captions', () => {
    expect(CLIP_TEMPLATES_V3.filter((t) => t.autoCaptions).map((t) => [t.name, t.autoCaptions])).toEqual([['Say it out loud', 'pop']]);
  });

  it('using a template saves a v3 clip of your own', async () => {
    const saved: Clip[] = [];
    const t = CLIP_TEMPLATES_V3.find((x) => x.id === 'say-it-out-loud')!;
    const clip = await makeFromTemplateV3(t, { id: 'mine', now: () => 5, save: async (c) => void saved.push(c) });
    expect(saved).toEqual([clip]);
    expect(clip).toMatchObject({ id: 'mine', createdAt: 5, history: [], recipe: { id: 'mine', name: 'Say it out loud', type: 'captions' } });
    expect(validateClip(clip.v3).ok).toBe(true);
    expect(clip.v3.packId).toBe('kinetic');
    expect(autoCaptionsOf(clip)).toBe('pop');
    const plain = await makeFromTemplateV3(CLIP_TEMPLATES_V3[0]!, { id: 'other', save: async () => undefined });
    expect(autoCaptionsOf(plain)).toBeUndefined();
  });
});
