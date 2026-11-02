import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Recipe } from '../types';
import { BUNDLED_FONTS, bundledFacesFor } from './fontList';

describe('bundled font list', () => {
  it('matches the faces styles/fonts.css declares for pages', () => {
    const css = readFileSync(new URL('../../styles/fonts.css', import.meta.url), 'utf8');
    const declared = [...css.matchAll(/font-family: '([^']+)';[^}]*font-weight: (\d+);[^}]*url\('([^']+)'\)/g)].map((m) => ({ family: m[1], weight: Number(m[2]), file: m[3] }));
    expect(declared).toEqual(BUNDLED_FONTS);
  });
  it('picks every face of the families the text layers use', () => {
    const recipe = { scenes: [{ layers: [{ type: 'text', font: 'Nunito' }, { type: 'image' }] }, { layers: [{ type: 'text', font: 'Geist' }] }] } as unknown as Recipe;
    expect(bundledFacesFor(recipe).map((f) => `${f.family} ${f.weight}`)).toEqual(['Nunito 400', 'Nunito 600', 'Nunito 700']);
  });
});
