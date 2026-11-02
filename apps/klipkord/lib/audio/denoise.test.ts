import { describe, expect, it, vi } from 'vitest';
import { createDenoiser, type DenoiseDeps } from './denoise';

/** A fake RNNoise node: like the real worklet it is silent until its wasm runs, then posts 'ready'. */
const fakeNode = (startsAfter: number | null = 0) => {
  const node = { port: { onmessage: null as ((e: MessageEvent) => void) | null }, running: false, destroy: vi.fn() };
  if (startsAfter !== null) setTimeout(() => {
    node.running = true;
    node.port.onmessage?.({ data: 'ready' } as MessageEvent);
  }, startsAfter);
  return node as unknown as AudioWorkletNode & { running: boolean; destroy: () => void };
};

const ctx = () => ({ audioWorklet: { addModule: vi.fn(async () => {}) } }) as unknown as BaseAudioContext;

describe('denoise', () => {
  it('loads the wasm once and the worklet module once per context, from extension URLs', async () => {
    const deps: DenoiseDeps = {
      urls: async () => ({ ready: 'chrome-extension://id/assets/rnnoiseReady.js', worklet: 'chrome-extension://id/assets/rnnoise.js', wasm: '/assets/rnnoise.wasm', simd: '/assets/rnnoise_simd.wasm' }),
      loadWasm: vi.fn(async () => new ArrayBuffer(8)),
      makeNode: vi.fn(() => fakeNode()),
    };
    const load = vi.fn(async () => deps);
    const denoise = createDenoiser(load);
    expect(load).not.toHaveBeenCalled();
    const a = ctx(), b = ctx();
    expect(await denoise(a)).toBe(vi.mocked(deps.makeNode).mock.results[0]!.value);
    await denoise(a);
    await denoise(b);
    expect(load).toHaveBeenCalledOnce();
    expect(deps.loadWasm).toHaveBeenCalledOnce();
    expect(vi.mocked(a.audioWorklet.addModule).mock.calls).toEqual([['chrome-extension://id/assets/rnnoiseReady.js'], ['chrome-extension://id/assets/rnnoise.js']]);
    expect(b.audioWorklet.addModule).toHaveBeenCalledTimes(2);
    expect(deps.makeNode).toHaveBeenCalledTimes(3);
  });

  it('tries again after a failed load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      urls: async () => ({ ready: 'r', worklet: 'w', wasm: 'a', simd: 'b' }), loadWasm: async () => new ArrayBuffer(1), makeNode: () => fakeNode(),
    });
    const denoise = createDenoiser(load);
    await expect(denoise(ctx())).rejects.toThrow('offline');
    await expect(denoise(ctx())).resolves.toBeDefined();
  });

  it('hands back the node only once RNNoise runs, so a render started right after is never silent', async () => {
    const deps = (): Promise<DenoiseDeps> => Promise.resolve({
      urls: async () => ({ ready: 'r', worklet: 'w', wasm: 'a', simd: 'b' }), loadWasm: async () => new ArrayBuffer(1), makeNode: () => fakeNode(30),
    });
    const node = (await createDenoiser(deps)(ctx())) as ReturnType<typeof fakeNode>;
    expect(node.running).toBe(true);
  });

  it('fails, destroying the node, when RNNoise never starts', async () => {
    const node = fakeNode(null);
    const deps = (): Promise<DenoiseDeps> => Promise.resolve({
      urls: async () => ({ ready: 'r', worklet: 'w', wasm: 'a', simd: 'b' }), loadWasm: async () => new ArrayBuffer(1), makeNode: () => node,
    });
    await expect(createDenoiser(deps, 20)(ctx())).rejects.toThrow('RNNoise did not start');
    expect(node.destroy).toHaveBeenCalledOnce();
  });
});
