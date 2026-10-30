import type { RenderItem } from '../exportPlan';
import type { Recipe } from '../types';
import type { MixedAudio } from './audio';

/** One video frame the worker needs from the page (layer-local time, as drawFrame asks for it). */
export interface FrameWant { assetId: string; ms: number }

export type ToWorker =
  | { type: 'start'; recipe: Recipe; item: RenderItem; audio?: MixedAudio }
  | { type: 'frames'; id: number; bitmaps: Record<string, ImageBitmap | null> }
  | { type: 'cancel' };

export type FromWorker =
  | { type: 'encoder'; hardware: boolean }
  | { type: 'need'; id: number; wants: FrameWant[] }
  | { type: 'progress'; frame: number; frames: number; tMs: number; preview?: ImageBitmap }
  | { type: 'done'; buffer: ArrayBuffer; mime: string }
  | { type: 'error'; reason: 'unsupported' | 'cancelled' | 'failed'; name: string; message: string };
