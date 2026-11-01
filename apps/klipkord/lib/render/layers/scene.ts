import type { RenderPlan } from '../../project/types';
import { drawCards, type DrawCard } from './cards';
import { drawCaption, layoutCaption } from './captions';
import { drawCursor } from './cursor';
import type { Scale, Size } from './geometry';
import type { Layer } from './order';
import { drawOverlays } from './overlays';
import type { Ctx2D } from './path';

/** Anything both backends can draw from: a decoded video frame, an image or a canvas. */
export type Picture = VideoFrame | ImageBitmap | OffscreenCanvas;

/** One frame to draw: the plan, sizes and the pictures the renderer fetched for it. */
export interface Scene {
  plan: RenderPlan;
  /** FRAME[shape]: the px the plan's boxes are in. */
  frame: Size;
  /** Canvas px. */
  width: number; height: number; scale: Scale;
  screen: Picture | null; camera: Picture | null; media: Picture | null;
  /** The background image, or the screen frame for "Blurred screen". */
  background: Picture | null;
  /** The camera's person mask from T11 (alpha = person), same framing as the camera picture. */
  mask: Picture | null;
  drawCard?: DrawCard;
  layers: Layer[];
}

export interface Backend {
  readonly kind: 'webgl2' | 'canvas2d';
  draw(scene: Scene): void;
  dispose(): void;
}

export const isVideoFrame = (p: Picture): p is VideoFrame => 'displayWidth' in p;
export function pictureSize(p: Picture, out: Size): Size {
  if (isVideoFrame(p)) {
    out.w = p.displayWidth;
    out.h = p.displayHeight;
  } else {
    out.w = p.width;
    out.h = p.height;
  }
  return out;
}

/** Layers both backends draw with Canvas 2D: WebGL2 lays the ones under the camera, then the ones over it, as textures. */
export const VECTOR_UNDER: readonly Layer[] = ['overlays', 'cursor'];
export const VECTOR_OVER: readonly Layer[] = ['cards', 'captions'];

/** Draws one vector layer in canvas px; the same code serves both backends so they give the same picture. */
export function drawVector(ctx: Ctx2D, scene: Scene, layer: Layer): void {
  const { plan, scale } = scene;
  ctx.save();
  ctx.setTransform(scale.x, 0, 0, scale.y, 0, 0);
  if (layer === 'overlays') drawOverlays(ctx, plan, scale.x);
  else if (layer === 'cursor' && plan.cursor) drawCursor(ctx, plan.cursor);
  else if (layer === 'cards') drawCards(ctx, plan, scene.frame, scale.x, scene.drawCard);
  else if (layer === 'captions' && plan.captions?.words.length) {
    const measure = (text: string, font: string) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    };
    drawCaption(ctx, layoutCaption(plan.captions, scene.frame, measure), scale.x);
  }
  ctx.restore();
}
