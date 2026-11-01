import { describe, expect, it } from 'vitest';
import prompts from './prompts.json';
import { check } from '../../lib/checker';
import { CALL_BUDGET } from '../../lib/ai/writeRecipe';
import { writeClip } from '../../lib/ai/writeRecipe';
import { validateRecipe } from '../../lib/recipe/validate';
import { replay, tinyFrame, type Recorded } from './replay';

describe('quality set: 20 recorded prompts through the whole v2 pipeline', () => {
  const set = prompts as Recorded[];

  it('covers every clip type, all three sizes and each pack five times', () => {
    expect(set).toHaveLength(20);
    expect(new Set(set.map((p) => p.type)).size).toBe(7);
    expect(new Set(set.map((p) => p.aspect)).size).toBe(3);
    for (const s of ['clean', 'bold', 'playful', 'corporate']) expect(set.filter((p) => p.style === s)).toHaveLength(5);
  });

  for (const r of set) {
    it(`${r.id} passes the checker, every call under ${CALL_BUDGET} tokens`, async () => {
      const { fetch, calls } = replay(r);
      const model = r.model ?? 'llama-3.3-70b-versatile';
      const out = await writeClip(
        { prompt: r.prompt, type: r.type, aspect: r.aspect, assets: r.assets ?? [], id: r.id, style: r.style, pace: r.pace, critic: true, settings: { ai: 'cloud', provider: 'groq', models: { groq: model } } },
        { ai: 'cloud', provider: 'groq', model, key: 'gsk_test', fetch },
        { frames: async (_rec, times) => times.map(() => tinyFrame) },
      );
      expect(validateRecipe(out.recipe)).toEqual([]);
      expect(out.recipe.version).toBe(2);
      expect(out.recipe.scenes.every((s) => s.template)).toBe(true);
      expect(check(out.recipe).map((i) => `${i.kind} ${i.sceneId} ${i.layerId} ${i.note ?? ''}`)).toEqual([]);
      expect(calls.filter((c) => c.kind === 'fill').length).toBeGreaterThanOrEqual(out.recipe.scenes.length);
      if (r.model) expect(calls.some((c) => c.kind === 'critic')).toBe(true);
      else expect(out.criticSkipped).toBe('critic-not-available');
      for (const c of calls) expect(c.tokens).toBeLessThan(CALL_BUDGET);
    });
  }
});
