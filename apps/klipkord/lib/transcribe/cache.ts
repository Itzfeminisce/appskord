import type { TranscriptConfig } from './groq';
import { BASE_MODEL, LIVE_MODEL } from './whisper';

// transformers.js keeps downloaded model files in this browser cache.
export const MODEL_CACHE = 'transformers-cache';

const WEIGHTS = ['encoder_model', 'decoder_model_merged'];

/** True when files of `model` are already in the browser cache. */
export async function isModelCached(model = BASE_MODEL, cacheStorage: Pick<CacheStorage, 'open'> | undefined = globalThis.caches): Promise<boolean> {
  if (!cacheStorage) return false;
  try {
    const cache = await cacheStorage.open(MODEL_CACHE);
    const urls = (await cache.keys()).map((r) => r.url.split('?')[0] ?? '').filter((u) => u.includes(`/${model}/`) && u.endsWith('.onnx'));
    // Config files alone are not the model; both weights the worker loads must be there.
    return WEIGHTS.every((w) => urls.some((u) => u.includes(`/${w}`)));
  } catch (error) {
    console.error('Klipkord: could not check the speech model', error);
    return false;
  }
}

/** Deletes the cached Whisper files; true when any were removed. */
export async function removeCachedModels(cacheStorage: Pick<CacheStorage, 'open'> | undefined = globalThis.caches): Promise<boolean> {
  if (!cacheStorage) return false;
  const cache = await cacheStorage.open(MODEL_CACHE);
  const gone = (await cache.keys()).filter((r) => [BASE_MODEL, LIVE_MODEL].some((m) => r.url.includes(`/${m}/`)));
  await Promise.all(gone.map((r) => cache.delete(r)));
  return gone.length > 0;
}

/** First recording on this computer with no model, never asked for: save with no transcript and download nothing. */
export async function shouldDefer(cfg: TranscriptConfig, cacheStorage?: Pick<CacheStorage, 'open'>): Promise<boolean> {
  return cfg.provider === 'local' && !cfg.localAsked && !(await isModelCached(BASE_MODEL, cacheStorage ?? globalThis.caches));
}
