import { describe, expect, it } from 'vitest';
import { applyBrand, brandEdit, familyFromFile, hasBrand, hexToHsv, hsvToHex, logoPath, normHex, withColour } from './brand';
import { check } from './checker';
import { applyPatch } from './patch';
import { validateRecipe } from './recipe/validate';
import type { BrandKit, Recipe } from './types';

const kit: BrandKit = {
  logoAssetId: 'brand-logo-svg', headingFont: 'Fraunces', bodyFont: 'Geist', useForNewClips: true,
  colours: [
    { hex: '#431407', role: 'text' }, { hex: '#B45309', role: 'primary' },
    { hex: '#FDE68A', role: 'accent' }, { hex: '#FFFBF5', role: 'background' },
  ],
};

const recipe = (): Recipe => ({
  version: 1, id: 'r', name: 'Clip', type: 'promo', aspect: '9:16', assets: {},
  scenes: [
    { id: 's1', durationMs: 5000, background: '#111114', layout: 'center', layers: [
      { id: 'card', name: 'Card', type: 'shape', shape: 'rect', fill: '#FFFFFF', startMs: 0, endMs: 5000, opacity: 1, box: { x: 0.1, y: 0.3, w: 0.8, h: 0.3 } },
      { id: 'rule', name: 'Rule', type: 'shape', shape: 'rect', fill: '#FFFFFF', startMs: 0, endMs: 5000, opacity: 1, box: { x: 0.1, y: 0.62, w: 0.2, h: 0.01 } },
      { id: 'title', name: 'Title', type: 'text', role: 'title', text: 'Fresh bread', font: 'Geist', sizePx: 80, weight: 700, colour: '#FFFFFF', align: 'left', lineHeight: 1.1, startMs: 0, endMs: 5000, opacity: 1, box: { x: 0.1, y: 0.35, w: 0.8, h: 0.15 } },
      { id: 'sub', name: 'Subtitle', type: 'text', role: 'body', text: 'Baked daily', font: 'Geist', sizePx: 40, weight: 500, colour: '#FFFFFF', align: 'left', lineHeight: 1.1, startMs: 0, endMs: 5000, opacity: 1, box: { x: 0.1, y: 0.5, w: 0.8, h: 0.08 } },
      { id: 'tag', name: 'Tag', type: 'text', role: 'caption', text: 'New', font: 'Geist', sizePx: 40, weight: 500, colour: '#FFFFFF', background: '#000000', align: 'center', lineHeight: 1.1, startMs: 0, endMs: 5000, opacity: 1, box: { x: 0.1, y: 0.7, w: 0.3, h: 0.06 } },
    ] },
  ],
});

const run = (r: Recipe, k = kit) => applyPatch(r, applyBrand(r, k)).doc;
const layer = (r: Recipe, id: string) => r.scenes[0]!.layers.find((l) => l.id === id)!;

describe('applyBrand', () => {
  it('sets colours by role, fonts by text role and brandApplied', () => {
    const out = run(recipe());
    expect(out.brandApplied).toBe(true);
    expect(out.scenes[0]!.background).toBe('#FFFBF5');
    expect(layer(out, 'title')).toMatchObject({ colour: '#431407', font: 'Fraunces' });
    expect(layer(out, 'sub')).toMatchObject({ colour: '#431407', font: 'Geist' });
    expect(layer(out, 'card')).toMatchObject({ fill: '#B45309' });
    expect(layer(out, 'rule')).toMatchObject({ fill: '#FDE68A' });
    expect(layer(out, 'tag')).toMatchObject({ background: '#B45309', colour: '#FFFFFF' });
  });

  it('keeps transparent backgrounds', () => {
    const r = recipe();
    r.scenes[0]!.background = 'transparent';
    expect(run(r).scenes[0]!.background).toBe('transparent');
  });

  it('adds a corner logo and its asset when the clip has none', () => {
    const out = run(recipe());
    expect(out.assets['brand-logo-svg']).toMatchObject({ kind: 'logo', opfsPath: logoPath('brand-logo-svg') });
    const logo = layer(out, 'brand-logo-s1');
    expect(logo).toMatchObject({ type: 'image', assetId: 'brand-logo-svg' });
    expect(check(out).filter((i) => i.kind === 'safe-area')).toEqual([]);
  });

  it('swaps an existing logo layer instead of adding another', () => {
    const r = recipe();
    r.assets.old = { id: 'old', kind: 'logo', name: 'old.png', mime: 'image/png', bytes: 1, opfsPath: 'media/old.png' };
    r.scenes[0]!.layers.push({ id: 'lg', name: 'Logo', type: 'image', assetId: 'old', fit: 'contain', startMs: 0, endMs: 5000, opacity: 1, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 } });
    const out = run(r);
    expect(layer(out, 'lg')).toMatchObject({ assetId: 'brand-logo-svg' });
    expect(out.scenes[0]!.layers.filter((l) => l.type === 'image')).toHaveLength(1);
  });

  it('output validates, with the font assets from brandEdit, and a second apply only sets nothing new', () => {
    const r = recipe();
    const edit = brandEdit(r, kit);
    const out = applyPatch(r, edit.ops).doc;
    expect(validateRecipe(out)).toEqual([]);
    expect(out.assets['brand-font-fraunces']).toMatchObject({ kind: 'font', name: 'Fraunces' });
    const again = brandEdit(out, kit).ops;
    expect(again.filter((o) => o.path.includes('/layers/') && !o.path.startsWith('/assets'))).toEqual([]);
    expect(validateRecipe(applyPatch(out, again).doc)).toEqual([]);
  });

  it('an empty kit only marks the clip', () => {
    expect(applyBrand(recipe(), { colours: [], useForNewClips: false })).toEqual([{ op: 'add', path: '/brandApplied', value: true }]);
  });
});

describe('familyFromFile', () => {
  it('turns a file name into a family name', () => {
    expect(familyFromFile('Fraunces-Bold.ttf')).toBe('Fraunces Bold');
    expect(familyFromFile('.ttf')).toBe('Your font');
  });
});

describe('brand kit states', () => {
  it('an empty kit has nothing to apply until a logo or colour exists', () => {
    expect(hasBrand({ colours: [], useForNewClips: false })).toBe(false);
    expect(hasBrand({ colours: [{ hex: '#111114', role: 'text' }], useForNewClips: false })).toBe(true);
    expect(hasBrand({ colours: [], logoAssetId: 'brand-logo-svg', useForNewClips: false })).toBe(true);
  });
  it('removes and restores a colour in role order', () => {
    const gone = withColour(kit, 'accent', undefined);
    expect(gone.colours.map((c) => c.role)).toEqual(['text', 'primary', 'background']);
    expect(withColour(gone, 'accent', '#FDE68A').colours).toEqual(kit.colours);
  });
  it('reads hex and converts to and from hue, saturation and value', () => {
    expect(normHex('abc')).toBe('#AABBCC');
    expect(normHex('#b45309')).toBe('#B45309');
    expect(normHex('#12')).toBeUndefined();
    for (const hex of ['#B45309', '#FFFFFF', '#000000', '#3366CC']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});
