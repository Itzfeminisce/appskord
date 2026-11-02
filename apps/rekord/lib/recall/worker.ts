/// <reference lib="webworker" />
// Dedicated worker started by the side panel on first use, so the model never loads with the panel or the recorder.
import { env, pipeline, type FeatureExtractionPipeline, type ProgressInfo } from '@huggingface/transformers';
import { MODEL_ID, type FromWorker, type ToWorker } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

// Runtime files ship in the extension (MV3 forbids remote code); only weights come from huggingface.co.
env.allowLocalModels = false;
env.backends.onnx.wasm!.wasmPaths = new URL('/ort/', scope.location.href).href;
// Threads need cross-origin isolation, which extension pages do not have.
env.backends.onnx.wasm!.numThreads = 1;

let extractor: Promise<FeatureExtractionPipeline> | undefined;

function load(id: number, localOnly: boolean): Promise<FeatureExtractionPipeline> {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress = (p: ProgressInfo) => {
    if (p.status !== 'progress') return;
    files.set(p.file, { loaded: p.loaded, total: p.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ id, type: 'progress', loaded, total });
  };
  // The generic pipeline() type is too large for tsc; this is its feature-extraction overload.
  const make = pipeline as unknown as (task: 'feature-extraction', model: string, options: object) => Promise<FeatureExtractionPipeline>;
  return make('feature-extraction', MODEL_ID, { dtype: 'q8', device: 'wasm', local_files_only: localOnly, progress_callback: progress });
}

scope.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  try {
    if (data.type === 'load') {
      extractor ??= load(data.id, data.localOnly);
      await extractor.catch((e) => {
        extractor = undefined;
        throw e;
      });
      post({ id: data.id, type: 'loaded' });
      return;
    }
    if (!extractor) throw new Error('The search model is not loaded.');
    const out = await (await extractor)(data.texts, { pooling: 'mean', normalize: true });
    const [n, dims] = out.dims as [number, number];
    const flat = out.data as Float32Array;
    const vectors = Array.from({ length: n }, (_, i) => flat.slice(i * dims, (i + 1) * dims));
    post({ id: data.id, type: 'embedded', vectors }, vectors.map((v) => v.buffer));
  } catch (e) {
    post({ id: data.id, type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
