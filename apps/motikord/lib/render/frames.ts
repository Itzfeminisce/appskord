import type { Aspect, Recipe } from '../types';
import { MediaCache } from './cache';
import { drawFrame, type Ctx } from './drawFrame';

/** Critic frames are small: 512 px on the long side. */
export const FRAME_LONG_SIDE = 512;

export interface FrameCanvas {
  width: number; height: number;
  getContext(id: '2d'): Ctx | null;
  convertToBlob(opts?: { type?: string; quality?: number }): Promise<Blob>;
}
export type CanvasFactory = (width: number, height: number) => FrameCanvas;
export interface FrameOptions { aspect?: Aspect; canvas?: CanvasFactory; cache?: MediaCache; quality?: number }

const RATIO: Record<Aspect, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 };

/** Frame size in px for a size, long side 512. */
export function frameSize(aspect: Aspect): { width: number; height: number } {
  const r = RATIO[aspect];
  return r >= 1 ? { width: FRAME_LONG_SIDE, height: Math.round(FRAME_LONG_SIDE / r) } : { width: Math.round(FRAME_LONG_SIDE * r), height: FRAME_LONG_SIDE };
}

const offscreen: CanvasFactory = (w, h) => new OffscreenCanvas(w, h) as unknown as FrameCanvas;

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

/** Draws the recipe at each time offscreen and returns JPEG data URLs, one per time. */
export async function renderFrames(recipe: Recipe, timesMs: number[], opts: FrameOptions = {}): Promise<string[]> {
  const aspect = opts.aspect ?? recipe.aspect;
  const { width, height } = frameSize(aspect);
  const canvas = (opts.canvas ?? offscreen)(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Motikord could not draw preview frames');
  const cache = opts.cache ?? new MediaCache();
  const out: string[] = [];
  for (const t of timesMs) {
    drawFrame(ctx, recipe, aspect, t, cache);
    out.push(await dataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: opts.quality ?? 0.7 })));
  }
  return out;
}
