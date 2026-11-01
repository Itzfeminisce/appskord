import type { Card, RenderPlan } from '../../project/types';
import type { Size } from './geometry';
import type { Ctx2D } from './path';

/** Where a card draws: the frame size and output time. T14 fills this from `packages/scenes`. */
export interface CardInfo { frame: Size; out: number; scale: number }
/** Draws one card over the picture; the context is in frame px. */
export type DrawCard = (ctx: Ctx2D, card: Card, info: CardInfo) => void;

const info: CardInfo = { frame: { w: 0, h: 0 }, out: 0, scale: 1 };

/** Cards in plan order, through the hook. Nothing is drawn until a hook is set. */
export function drawCards(ctx: Ctx2D, plan: RenderPlan, frame: Size, scale: number, drawCard: DrawCard | undefined): void {
  if (!drawCard) return;
  info.frame = frame;
  info.out = plan.out;
  info.scale = scale;
  for (const card of plan.cards) {
    ctx.save();
    try {
      drawCard(ctx, card, info);
    } catch (error) {
      console.error('Klipkord: could not draw card', error);
    }
    ctx.restore();
  }
}
