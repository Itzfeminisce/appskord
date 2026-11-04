import { describe, expect, it } from 'vitest';
import { LOCAL_CONFIG } from './groq';
import { isModelCached, removeCachedModels, shouldDefer } from './cache';
import { BASE_MODEL } from './whisper';

const store = (urls: string[]) => ({ open: async () => ({ keys: async () => urls.map((url) => ({ url })) }) }) as unknown as CacheStorage;
const base = `https://huggingface.co/${BASE_MODEL}/resolve/main`;
const cached = store([`${base}/onnx/encoder_model_q8.onnx`, `${base}/onnx/decoder_model_merged_q8.onnx`]);
const empty = store([]);

describe('model cache', () => {
  it('finds a cached model and nothing in an empty cache', async () => {
    expect(await isModelCached(BASE_MODEL, cached)).toBe(true);
    expect(await isModelCached(BASE_MODEL, empty)).toBe(false);
    expect(await isModelCached(BASE_MODEL, undefined)).toBe(false);
  });

  it('needs both weights, not just config files', async () => {
    expect(await isModelCached(BASE_MODEL, store([`${base}/config.json`]))).toBe(false);
    expect(await isModelCached(BASE_MODEL, store([`${base}/onnx/encoder_model_q8.onnx`]))).toBe(false);
  });

  it('defers only on this computer, with no model and never asked', async () => {
    expect(await shouldDefer(LOCAL_CONFIG, empty)).toBe(true);
    expect(await shouldDefer({ ...LOCAL_CONFIG, localAsked: true }, empty)).toBe(false);
    expect(await shouldDefer(LOCAL_CONFIG, cached)).toBe(false);
    expect(await shouldDefer({ ...LOCAL_CONFIG, provider: 'groq', key: 'fake-key' }, empty)).toBe(false);
  });
});

describe('removeCachedModels', () => {
  it('deletes the Whisper files only', async () => {
    const urls = ['https://h/onnx-community/whisper-base_timestamped/a.onnx', 'https://h/onnx-community/whisper-tiny/b.onnx', 'https://h/other/c.bin'];
    const kept = new Set(urls);
    const cache = { keys: async () => [...kept].map((url) => ({ url }) as Request), delete: async (r: Request) => kept.delete(r.url) };
    expect(await removeCachedModels({ open: async () => cache as unknown as Cache })).toBe(true);
    expect([...kept]).toEqual(['https://h/other/c.bin']);
    expect(await removeCachedModels(undefined)).toBe(false);
  });
});
