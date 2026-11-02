/** Messages between the side panel and the recall worker. */
export const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
/** Cache API bucket transformers.js keeps downloaded weights in. */
export const MODEL_CACHE = 'transformers-cache';
export const DIMENSIONS = 384;

export type ToWorker =
  | { id: number; type: 'load'; localOnly: boolean }
  | { id: number; type: 'embed'; texts: string[] };

export type FromWorker =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'loaded' }
  | { id: number; type: 'embedded'; vectors: Float32Array[] }
  | { id: number; type: 'error'; message: string };
