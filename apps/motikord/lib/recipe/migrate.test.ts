import { describe, expect, it } from 'vitest';
import { MediaCache } from '../render/cache';
import { drawFrame, type Ctx } from '../render/drawFrame';
import { TEMPLATES } from '../templates/index';
import { migrate, toV2 } from './migrate';
import { validateRecipe } from './validate';

const ctx = () => new Proxy({ canvas: { width: 1080, height: 1920 }, measureText: (s: string) => ({ width: s.length * 20 }) } as Record<string, unknown>,
  { get: (t, k) => (k in t ? t[k as string] : () => {}), set: () => true }) as unknown as Ctx;

describe('migrate', () => {
  for (const t of TEMPLATES) {
    it(`keeps the v1 template ${t.name} unchanged, valid and drawable`, () => {
      const before = structuredClone(t.recipe);
      const r = migrate(t.recipe);
      expect(r).toEqual(before);
      expect(r.version).toBe(1);
      expect(validateRecipe(r)).toEqual([]);
      for (const a of ['9:16', '1:1', '16:9'] as const) expect(() => drawFrame(ctx(), r, a, 500, new MediaCache())).not.toThrow();
    });
  }

  it('moves to version 2 only when a look is applied', () => {
    const r = TEMPLATES[0]!.recipe;
    expect(toV2(r).version).toBe(2);
    expect(r.version).toBe(1);
  });
});
