// "Remove background noise": RNNoise in an AudioWorklet, loaded on first use from files inside the extension.

export interface DenoiseDeps {
  /** URLs of the ready shim, the worklet script and the two wasm builds, all packaged with the extension. */
  urls(): Promise<{ ready: string; worklet: string; wasm: string; simd: string }>;
  /** Fetches the wasm build this browser can run. */
  loadWasm(urls: { wasm: string; simd: string }): Promise<ArrayBuffer>;
  /** Makes the worklet node once the processor is registered in `ctx`. */
  makeNode(ctx: BaseAudioContext, wasm: ArrayBuffer): AudioWorkletNode;
}

/** How long a node may take to start its wasm before noise removal counts as failed. */
const READY_MS = 15_000;

async function packaged(): Promise<DenoiseDeps> {
  const [lib, ready, worklet, wasm, simd] = await Promise.all([
    import('@sapphi-red/web-noise-suppressor'),
    import('./rnnoiseReady.js?url&no-inline'),
    import('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'),
    import('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'),
  ]);
  return {
    urls: async () => ({ ready: ready.default, worklet: worklet.default, wasm: wasm.default, simd: simd.default }),
    loadWasm: ({ wasm: url, simd: simdUrl }) => lib.loadRnnoise({ url, simdUrl }),
    // The node takes an AudioContext in its types; an OfflineAudioContext runs worklets the same way.
    makeNode: (ctx, wasmBinary) => new lib.RnnoiseWorkletNode(ctx as AudioContext, { maxChannels: 2, wasmBinary }),
  };
}

/** Resolves when the node's processor has started its wasm (rnnoiseReady.js says so); until then it outputs silence. */
function whenReady(node: AudioWorkletNode, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      node.port.onmessage = null;
      reject(new Error('RNNoise did not start'));
    }, ms);
    node.port.onmessage = (event: MessageEvent) => {
      if (event.data !== 'ready') return;
      clearTimeout(timer);
      node.port.onmessage = null;
      resolve();
    };
  });
}

/**
 * Lazy, shared loader: the library and wasm load once, the worklet modules once per context. The node comes back only
 * once RNNoise runs, so an offline render started right after never renders its silent warm-up.
 */
export function createDenoiser(deps: () => Promise<DenoiseDeps> = packaged, readyMs = READY_MS) {
  let ready: Promise<{ d: DenoiseDeps; shim: string; worklet: string; wasm: ArrayBuffer }> | null = null;
  const added = new WeakMap<BaseAudioContext, Promise<void>>();
  return async (ctx: BaseAudioContext): Promise<AudioNode> => {
    ready ??= (async () => {
      const d = await deps();
      const urls = await d.urls();
      return { d, shim: urls.ready, worklet: urls.worklet, wasm: await d.loadWasm(urls) };
    })().catch((error: unknown) => {
      ready = null;
      throw error;
    });
    const { d, shim, worklet, wasm } = await ready;
    let module = added.get(ctx);
    if (!module) {
      // The shim must be in the scope before RNNoise registers its processor.
      module = ctx.audioWorklet.addModule(shim).then(() => ctx.audioWorklet.addModule(worklet));
      added.set(ctx, module);
    }
    await module;
    const node = d.makeNode(ctx, wasm);
    try {
      await whenReady(node, readyMs);
    } catch (error) {
      (node as { destroy?: () => void }).destroy?.();
      throw error;
    }
    return node;
  };
}

/** The app's one denoiser; nothing loads until the first call. */
export const denoise = createDenoiser();
