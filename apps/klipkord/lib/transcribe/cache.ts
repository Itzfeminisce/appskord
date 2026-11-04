import type { TranscriptConfig } from './groq';
import { BASE_MODEL } from './whisper';

// transformers.js keeps downloaded model files in this browser cache.
const CACHE_NAME = 'transformers-cache';

/** True when files of `model` are already in the browser cache. */
export async function isModelCached(model = BASE_MODEL, cacheStorage: Pick<CacheStorage, 'open'> | undefined = globalThis.caches): Promise<boolean> {
  if (!cacheStorage) return false;
  try {
    const cache = await cacheStorage.open(CACHE_NAME);
    return (await cache.keys()).some((r) => r.url.includes(`/${model}/`));
  } catch (error) {
    console.error('Klipkord: could not check the speech model', error);
    return false;
  }
}

/** First recording on this computer with no model, never asked for: save with no transcript and download nothing. */
export async function shouldDefer(cfg: TranscriptConfig, cacheStorage?: Pick<CacheStorage, 'open'>): Promise<boolean> {
  return cfg.provider === 'local' && !cfg.localAsked && !(await isModelCached(BASE_MODEL, cacheStorage ?? globalThis.caches));
}
