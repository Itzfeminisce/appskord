import { describe, expect, it, vi } from 'vitest';
import { createDenoiser, type DenoiseDeps } from './denoise';

const ctx = () => ({ audioWorklet: { addModule: vi.fn(async () => {}) } }) as unknown as BaseAudioContext;

describe('denoise', () => {
  it('loads the wasm once and the worklet module once per context, from extension URLs', async () => {
    const node = {} as AudioNode;
    const deps: DenoiseDeps = {
      urls: async () => ({ worklet: 'chrome-extension://id/assets/rnnoise.js', wasm: '/assets/rnnoise.wasm', simd: '/assets/rnnoise_simd.wasm' }),
      loadWasm: vi.fn(async () => new ArrayBuffer(8)),
      makeNode: vi.fn(() => node),
    };
    const load = vi.fn(async () => deps);
    const denoise = createDenoiser(load);
    expect(load).not.toHaveBeenCalled();
    const a = ctx(), b = ctx();
    expect(await denoise(a)).toBe(node);
    await denoise(a);
    await denoise(b);
    expect(load).toHaveBeenCalledOnce();
    expect(deps.loadWasm).toHaveBeenCalledOnce();
    expect(a.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(a.audioWorklet.addModule).toHaveBeenCalledWith('chrome-extension://id/assets/rnnoise.js');
    expect(b.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(deps.makeNode).toHaveBeenCalledTimes(3);
  });

  it('tries again after a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      urls: async () => ({ worklet: 'w', wasm: 'a', simd: 'b' }), loadWasm: async () => new ArrayBuffer(1), makeNode: () => ({}) as AudioNode,
    });
    const denoise = createDenoiser(load);
    await expect(denoise(ctx())).rejects.toThrow('offline');
    await expect(denoise(ctx())).resolves.toBeDefined();
  });
});
