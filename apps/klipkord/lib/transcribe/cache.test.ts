import { describe, expect, it } from 'vitest';
import { LOCAL_CONFIG } from './groq';
import { isModelCached, shouldDefer } from './cache';
import { BASE_MODEL } from './whisper';

const store = (urls: string[]) => ({ open: async () => ({ keys: async () => urls.map((url) => ({ url })) }) }) as unknown as CacheStorage;
const cached = store([`https://huggingface.co/${BASE_MODEL}/resolve/main/config.json`]);
const empty = store([]);

describe('model cache', () => {
  it('finds a cached model and nothing in an empty cache', async () => {
    expect(await isModelCached(BASE_MODEL, cached)).toBe(true);
    expect(await isModelCached(BASE_MODEL, empty)).toBe(false);
    expect(await isModelCached(BASE_MODEL, undefined)).toBe(false);
  });

  it('defers only on this computer, with no model and never asked', async () => {
    expect(await shouldDefer(LOCAL_CONFIG, empty)).toBe(true);
    expect(await shouldDefer({ ...LOCAL_CONFIG, localAsked: true }, empty)).toBe(false);
    expect(await shouldDefer(LOCAL_CONFIG, cached)).toBe(false);
    expect(await shouldDefer({ ...LOCAL_CONFIG, provider: 'groq', key: 'fake-key' }, empty)).toBe(false);
  });
});
