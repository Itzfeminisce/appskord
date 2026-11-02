import type { BrandKit } from '@appskord/brand';
import type { Card } from '../../project/types';
import type { DrawCard } from './cards';
import type { Ctx2D } from './path';

/** How a card looks: its style pack and the brand kit when one exists. */
export interface CardLook { pack: Card['pack']; brand?: BrandKit }
/** Fonts and images a scene loads once and reuses frame to frame. */
export type SceneCache = Map<string, unknown>;
/** The planned call into `packages/scenes` (Motikord's scene templates); it fills the context's whole box. */
export type DrawScene = (
  ctx: Ctx2D, scene: { template: string; slots: Record<string, string>; look: CardLook }, aspect: number, tMs: number, cache: SceneCache,
) => void;

/**
 * SEAM for `packages/scenes`: set this to its `drawScene` once that package is on main.
 * Until then nothing draws cards and the Text and cards panel shows `cards-not-ready`.
 */
export const SCENES_DRAW_SCENE = undefined as DrawScene | undefined;

export const cardsReady = (): boolean => SCENES_DRAW_SCENE !== undefined;

/**
 * The renderer's `drawCard` hook built on `drawScene`; undefined while there is none, so the cards layer stays off.
 * `startOf`: the card's start in output time (cards anchor to recording time; the cut maps it).
 */
export function drawCardWith(
  drawScene: DrawScene | undefined, startOf: (card: Card) => number | null, look: (card: Card) => CardLook = (card) => ({ pack: card.pack }),
  cache: SceneCache = new Map(),
): DrawCard | undefined {
  if (!drawScene) return undefined;
  return (ctx, card, info) => {
    const start = startOf(card);
    if (start === null || info.frame.h <= 0) return;
    drawScene(ctx, { template: card.template, slots: card.slots, look: look(card) }, info.frame.w / info.frame.h, Math.max(0, info.out - start), cache);
  };
}

/** The hook the preview and export pass the renderer: none until `packages/scenes` lands. */
export const drawCard = (startOf: (card: Card) => number | null, look?: (card: Card) => CardLook): DrawCard | undefined =>
  drawCardWith(SCENES_DRAW_SCENE, startOf, look);
