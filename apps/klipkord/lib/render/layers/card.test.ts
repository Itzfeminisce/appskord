import { describe, expect, it, vi } from 'vitest';
import type { Card, Cut } from '../../project/types';
import { CARD_FONTS, capWords, cardAssets, cardSlots, cardStarts, drawCardWith, sceneAspect, sceneSpec, type DrawScene } from './card';
import type { Ctx2D } from './path';

const card: Card = { id: 'c', template: 'title-hook', at: 1000, ms: 3000, slots: { headline: 'Invite your team' }, pack: 'bold' };
const ctx = {} as Ctx2D;

describe('card seam', () => {
  it('calls drawScene with the template, slots, look, scenes aspect and time into the card', () => {
    const scene = vi.fn<DrawScene>();
    const hook = drawCardWith(scene, (c) => (c.id === 'c' ? 400 : null));
    hook(ctx, card, { frame: { w: 1080, h: 1920 }, out: 1400, scale: 1 });
    expect(scene).toHaveBeenCalledWith(ctx, { template: 'title-hook', slots: { headline: 'Invite your team' }, look: { style: 'bold' }, durationMs: 3000 }, '9:16', 1000, undefined);
    hook(ctx, { ...card, id: 'cut-away' }, { frame: { w: 1920, h: 1080 }, out: 1400, scale: 1 });
    hook(ctx, { ...card, template: 'nope' }, { frame: { w: 1920, h: 1080 }, out: 1400, scale: 1 });
    expect(scene).toHaveBeenCalledTimes(1);
  });

  it('lays a brand kit over the pack only when it sets something', () => {
    expect(sceneSpec(card, { colours: [], useForNewClips: false })?.look).toEqual({ style: 'bold' });
    const brand = { colours: [{ hex: '#FF0000', role: 'primary' as const }], useForNewClips: false };
    expect(sceneSpec(card, brand)?.look).toEqual({ style: 'bold', brand });
  });

  it('gives each planned card its start in output time', () => {
    const cut = { clips: [{ id: 'a', in: 0, out: 500, speed: 1 }, { id: 'b', in: 900, out: 5000, speed: 1 }] } as unknown as Cut;
    expect(cardStarts(cut, [card, { ...card, id: 'gone', at: 700 }])).toEqual({ c: 600 });
  });

  it('maps shapes to scenes sizes', () => {
    expect([sceneAspect(1920, 1080), sceneAspect(1080, 1920), sceneAspect(1080, 1080), sceneAspect(1080, 1350)]).toEqual(['16:9', '9:16', '1:1', '1:1']);
  });

  it('lists text slots with word limits; the headline is the one a title hook needs', () => {
    expect(cardSlots('title-hook')).toEqual([
      { id: 'kicker', name: 'Kicker', words: 4, optional: true },
      { id: 'headline', name: 'Headline', words: 6, optional: false },
    ]);
    expect(cardSlots('logo-sting').every((s) => s.optional)).toBe(true);
    expect(cardSlots('nope')).toEqual([]);
  });

  it('caps words and keeps a trailing space while typing', () => {
    expect(capWords('one two three', 2)).toBe('one two');
    expect(capWords('one two ', 2)).toBe('one two ');
  });

  it('ships only the faces the three packs use', () => {
    const families = new Set(CARD_FONTS.map((f) => f.family));
    expect(families).toEqual(new Set(['Inter', 'Archivo Black', 'Archivo', 'Fredoka', 'Nunito', 'Space Grotesk']));
  });

  it('checks fonts on its font set and drops a logo that is not there', async () => {
    const fonts = { add: vi.fn(), check: vi.fn(() => true) };
    const assets = cardAssets(fonts, 'chrome-extension://x/');
    expect(assets.cache.fontReady('Inter', 700)).toBe(true);
    expect(fonts.check).toHaveBeenCalledWith('700 16px "Inter"');
    await assets.setBrand({ kit: { colours: [], logoAssetId: 'brand-logo-png', useForNewClips: false }, updatedAt: 1 });
    expect(assets.brand()).toEqual({ colours: [], useForNewClips: false });
    await assets.setBrand(null);
    expect(assets.brand()).toBeUndefined();
  });
});
