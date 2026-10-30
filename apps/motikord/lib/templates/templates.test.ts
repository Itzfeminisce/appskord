import { describe, expect, it } from 'vitest';
import { check } from '../checker';
import { CLIP_TYPES, MAX_CLIP_MS, validateRecipe } from '../recipe/validate';
import { PRESET_IDS } from '../render/presets';
import { copyTemplate, formatLength, TEMPLATES } from './index';

describe('templates', () => {
  it('has about twenty covering all seven clip types', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(18);
    expect(new Set(TEMPLATES.map((t) => t.type))).toEqual(new Set(CLIP_TYPES));
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });

  for (const t of TEMPLATES) {
    it(`${t.name} is valid, uses real presets and has no checker issues`, () => {
      expect(validateRecipe(t.recipe)).toEqual([]);
      expect(t.lengthMs).toBeLessThanOrEqual(MAX_CLIP_MS);
      for (const l of t.recipe.scenes.flatMap((s) => s.layers)) {
        for (const m of [l.in, l.during, l.out]) if (m) expect(PRESET_IDS).toContain(m.preset);
      }
      expect(check(t.recipe).filter((i) => i.kind === 'overflow')).toEqual([]);
      expect(check(t.recipe)).toEqual([]);
    });
  }

  it('copies into a new recipe that shares nothing', () => {
    const t = TEMPLATES[0]!;
    const copy = copyTemplate(t, 'mine');
    expect(copy.id).toBe('mine');
    copy.scenes[0]!.durationMs = 1;
    expect(t.recipe.scenes[0]!.durationMs).not.toBe(1);
  });

  it('formats lengths', () => {
    expect(formatLength(8000)).toBe('0:08');
    expect(formatLength(75000)).toBe('1:15');
  });
});
