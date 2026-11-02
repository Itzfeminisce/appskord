/** Side panel end of the recall worker: loads the search model on demand and embeds text. */
import { HUGGINGFACE_HOSTS, requestHosts } from '../hosts';
import { record } from '../ledger';
import { MODEL_CACHE, MODEL_ID, type FromWorker, type ToWorker } from './protocol';

export type ModelState = 'none' | 'downloading' | 'ready' | 'failed';
export interface Progress { loaded: number; total: number }

export interface WorkerLike {
  postMessage(m: ToWorker): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

const startWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as WorkerLike;
let makeWorker: () => WorkerLike = startWorker;
/** Tests swap in a fake worker; no model or network. */
export function setWorkerFactory(f: (() => WorkerLike) | undefined): void {
  resetModel();
  makeWorker = f ?? startWorker;
}

interface Pending { resolve: (m: FromWorker) => void; reject: (e: Error) => void; onProgress?: (p: Progress) => void }
let worker: WorkerLike | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
let state: ModelState = 'none';
let loading: Promise<boolean> | undefined;

function failAll(message: string): void {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

function getWorker(): WorkerLike {
  if (worker) return worker;
  const w = makeWorker();
  w.onmessage = ({ data }) => {
    const p = pending.get(data.id);
    if (!p) return;
    if (data.type === 'progress') return p.onProgress?.({ loaded: data.loaded, total: data.total });
    pending.delete(data.id);
    if (data.type === 'error') p.reject(new Error(data.message));
    else p.resolve(data);
  };
  w.onerror = (e) => {
    failAll(e.message || 'The search worker stopped.');
    w.terminate();
    if (worker === w) worker = undefined;
    loading = undefined;
  };
  worker = w;
  return w;
}

type Request = ToWorker extends infer T ? (T extends ToWorker ? Omit<T, 'id'> : never) : never;

function call(msg: Request, onProgress?: (p: Progress) => void): Promise<FromWorker> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...msg, id } as ToWorker);
  });
}

/** True when transformers.js has this model's weights in the Cache API. */
export async function hasCachedModel(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined' || !(await caches.has(MODEL_CACHE))) return false;
    const keys = await (await caches.open(MODEL_CACHE)).keys();
    return keys.some((r) => r.url.includes(MODEL_ID) && r.url.endsWith('.onnx'));
  } catch {
    return false;
  }
}

/** 'ready' also when the weights are on disk but not loaded yet this session. */
export async function modelState(): Promise<ModelState> {
  if (state !== 'none') return state;
  return (await hasCachedModel()) ? 'ready' : 'none';
}

function load(localOnly: boolean, onProgress?: (p: Progress) => void): Promise<boolean> {
  loading ??= call({ type: 'load', localOnly }, onProgress).then(
    () => {
      state = 'ready';
      return true;
    },
    (e) => {
      loading = undefined;
      if (!localOnly) {
        state = 'failed';
        console.error('Rekord: could not download the search model', e);
      }
      return false;
    },
  );
  return loading;
}

/**
 * The "Download (22 MB)" click: asks for the huggingface.co hosts (first, so the click still counts),
 * then downloads the weights with progress. One ledger entry per download. Resolves false, never throws.
 */
export async function ensureModel(onProgress?: (p: Progress) => void): Promise<boolean> {
  const asked = requestHosts(HUGGINGFACE_HOSTS);
  if (!(await asked)) return false;
  if (state === 'ready' && loading) return true;
  const cached = await hasCachedModel();
  state = 'downloading';
  loading = undefined;
  const ok = await load(cached, onProgress);
  if (ok && !cached) await record({ service: 'huggingface', what: 'Search model download' }).catch((e) => console.error('Rekord: could not record the model download', e));
  if (!ok && cached) state = 'failed';
  return ok;
}

/** Loads the model only from cached weights, never downloading. False when there is none. */
export async function loadCachedModel(): Promise<boolean> {
  if (loading) return loading;
  if (!(await hasCachedModel())) return false;
  return load(true);
}

/** Normalized 384-number vectors for each text. The model must be loaded. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return [];
  const reply = await call({ type: 'embed', texts });
  return reply.type === 'embedded' ? reply.vectors : [];
}

function resetModel(): void {
  failAll('The search model was removed.');
  worker?.terminate();
  worker = undefined;
  loading = undefined;
  state = 'none';
}

/** Deletes the cached weights and stops the worker; search falls back to keywords. */
export async function removeModel(): Promise<void> {
  resetModel();
  try {
    if (typeof caches !== 'undefined') await caches.delete(MODEL_CACHE);
  } catch (e) {
    console.error('Rekord: could not remove the search model', e);
  }
}
