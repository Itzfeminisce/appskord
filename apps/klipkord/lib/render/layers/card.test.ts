import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../project/types';
import { cardsReady, drawCard, drawCardWith, type DrawScene } from './card';
import type { Ctx2D } from './path';

const card: Card = { id: 'c', template: 'title-hook', at: 1000, ms: 3000, slots: { headline: 'Invite your team' }, pack: 'bold' };
const ctx = {} as Ctx2D;

describe('card seam', () => {
  it('draws nothing until packages/scenes lands', () => {
    expect(cardsReady()).toBe(false);
    expect(drawCard(() => 0)).toBeUndefined();
  });

  it('calls drawScene with the template, slots, look, frame aspect and time into the card', () => {
    const scene = vi.fn<DrawScene>();
    const hook = drawCardWith(scene, (c) => (c.id === 'c' ? 400 : null))!;
    hook(ctx, card, { frame: { w: 1080, h: 1920 }, out: 1400, scale: 1 });
    expect(scene).toHaveBeenCalledWith(ctx, { template: 'title-hook', slots: { headline: 'Invite your team' }, look: { pack: 'bold' } }, 1080 / 1920, 1000, expect.any(Map));
    hook(ctx, { ...card, id: 'cut-away' }, { frame: { w: 1920, h: 1080 }, out: 1400, scale: 1 });
    expect(scene).toHaveBeenCalledTimes(1);
  });
});
