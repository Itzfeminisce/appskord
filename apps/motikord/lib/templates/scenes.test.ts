import { describe, expect, it } from 'vitest';
import { CLIP_TYPES, validatePack, validateSceneTemplate } from '../recipe/validate';
import { autoStyle, getPack, getSceneTemplate, isBackgroundBox, SAFE_AREA, SCENE_TEMPLATES, STYLE_PACKS } from './scenes';

describe('scene templates and style packs', () => {
  it('has the 12 templates in frame order and the 4 packs', () => {
    expect(SCENE_TEMPLATES.map((t) => t.id)).toEqual(['title-hook', 'big-statement', 'stat-reveal', 'chart', 'quote', 'list',
      'hero', 'split', 'before-after', 'steps', 'logo-sting', 'end-card']);
    expect(STYLE_PACKS.map((p) => p.id)).toEqual(['clean', 'bold', 'playful', 'corporate']);
    expect(getSceneTemplate('quote')?.name).toBe('Quote');
    expect(getPack('bold')?.fonts.display).toBe('Archivo Black');
    expect(getSceneTemplate('meme')).toBeUndefined();
  });

  for (const t of SCENE_TEMPLATES) {
    it(`${t.name} is valid and keeps its slots inside the safe area`, () => {
      expect(validateSceneTemplate(t)).toEqual([]);
      for (const d of t.slots) for (const [aspect, b] of Object.entries(d.boxes)) {
        if (d.kind === 'media' && isBackgroundBox(b)) continue;
        const s = SAFE_AREA[aspect as keyof typeof SAFE_AREA];
        expect(b.x >= s.x - 1e-6 && b.y >= s.y - 1e-6 && b.x + b.w <= s.x + s.w + 1e-6 && b.y + b.h <= s.y + s.h + 1e-6, `${d.id} at ${aspect}`).toBe(true);
      }
    });
  }

  it('keeps the frame word limits', () => {
    const limit = (t: string, s: string) => getSceneTemplate(t)!.slots.find((d) => d.id === s)!.words;
    expect([limit('title-hook', 'kicker'), limit('title-hook', 'headline'), limit('big-statement', 'statement'), limit('quote', 'quote'),
      limit('split', 'body'), limit('end-card', 'handle')]).toEqual([4, 6, 10, 24, 16, 4]);
    expect(getSceneTemplate('list')!.slots.find((d) => d.id === 'items')!.items).toEqual([3, 5]);
    expect(getSceneTemplate('chart')!.slots.find((d) => d.id === 'bars')!.items).toEqual([2, 6]);
  });

  for (const p of STYLE_PACKS) {
    it(`${p.name} pack validates and sets numbers in Space Grotesk`, () => {
      expect(validatePack(p)).toEqual([]);
      expect(p.fonts.number).toBe('Space Grotesk');
    });
  }

  it('rejects a broken pack and template', () => {
    expect(validatePack({ ...getPack('clean')!, transitions: ['spin'] }).join()).toMatch(/transitions must be from/);
    const t = getSceneTemplate('hero')!;
    expect(validateSceneTemplate({ ...t, slots: [{ ...t.slots[0]!, motion: { in: 'zoom' } }] }).join()).toMatch(/not a known in preset/);
  });

  it('picks a pack for every clip type with Auto', () => {
    expect(CLIP_TYPES.map(autoStyle)).toEqual(['bold', 'corporate', 'corporate', 'clean', 'playful', 'clean', 'bold']);
  });
});
