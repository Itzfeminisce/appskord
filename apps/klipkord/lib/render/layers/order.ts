import type { Overlay, RenderPlan } from '../../project/types';

/** What the renderer draws, bottom to top. Both backends follow this list. */
export type Layer = 'background' | 'screen' | 'media' | 'privacy' | 'overlays' | 'cursor' | 'camera' | 'cards' | 'captions' | 'fade';

/** Blur, pixelate and solid boxes hide part of the screen picture, so they draw right on it and never fade. */
export const isPrivacy = (o: Overlay) => o.kind === 'blur';

/** The layers this plan needs, bottom to top. `cards`: a card hook is set. */
export function layerOrder(plan: RenderPlan, cards: boolean): Layer[] {
  const list: Layer[] = ['background'];
  if (plan.screen) list.push('screen');
  if (plan.media) list.push('media');
  if (plan.screen && plan.overlays.some(isPrivacy)) list.push('privacy');
  if (plan.screen && plan.overlays.some((o) => !isPrivacy(o))) list.push('overlays');
  if (plan.cursor) list.push('cursor');
  if (plan.camera) list.push('camera');
  if (cards && plan.cards.length) list.push('cards');
  if (plan.captions?.words.length) list.push('captions');
  if (plan.fade > 0) list.push('fade');
  return list;
}
