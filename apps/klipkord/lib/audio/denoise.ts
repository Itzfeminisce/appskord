// "Remove background noise": RNNoise in an AudioWorklet, loaded on first use from files inside the extension.

export interface DenoiseDeps {
  /** URLs of the worklet script and the two wasm builds, all packaged with the extension. */
  urls(): Promise<{ worklet: string; wasm: string; simd: string }>;
  /** Fetches the wasm build this browser can run. */
  loadWasm(urls: { wasm: string; simd: string }): Promise<ArrayBuffer>;
  /** Makes the worklet node once the processor is registered in `ctx`. */
  makeNode(ctx: BaseAudioContext, wasm: ArrayBuffer): AudioNode;
}

async function packaged(): Promise<DenoiseDeps> {
  const [lib, worklet, wasm, simd] = await Promise.all([
    import('@sapphi-red/web-noise-suppressor'),
    import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
  ]);
  return {
    urls: async () => ({ worklet: worklet.default, wasm: wasm.default, simd: simd.default }),
    loadWasm: ({ wasm: url, simd: simdUrl }) => lib.loadRnnoise({ url, simdUrl }),
    // The node takes an AudioContext in its types; an OfflineAudioContext runs worklets the same way.
    makeNode: (ctx, wasmBinary) => new lib.RnnoiseWorkletNode(ctx as AudioContext, { maxChannels: 2, wasmBinary }),
  };
}

/** Lazy, shared loader: the library and wasm load once, the worklet module once per context. */
export function createDenoiser(deps: () => Promise<DenoiseDeps> = packaged) {
  let ready: Promise<{ d: DenoiseDeps; worklet: string; wasm: ArrayBuffer }> | null = null;
  const added = new WeakMap<BaseAudioContext, Promise<void>>();
  return async (ctx: BaseAudioContext): Promise<AudioNode> => {
    ready ??= (async () => {
      const d = await deps();
      const urls = await d.urls();
      return { d, worklet: urls.worklet, wasm: await d.loadWasm(urls) };
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    const { d, worklet, wasm } = await ready;
    let module = added.get(ctx);
    if (!module) {
      module = ctx.audioWorklet.addModule(worklet);
      added.set(ctx, module);
    }
    await module;
    return d.makeNode(ctx, wasm);
  };
}

/** The app's one denoiser; nothing loads until the first call. */
export const denoise = createDenoiser();
