// The page side of an export: builds the job, feeds the worker the mix in chunks, and saves what it makes.
import { exportMix, type MixChunk } from '../audio/export';
import { mediaLoader } from '../audio/load';
import { mixPlan } from '../audio/mix';
import type { Cut, Project } from '../project/types';
import type { Word } from '../types';
import type { ExportRequest, ExportResponse, Job } from './protocol';
export { renderCut } from './cut';

export interface RunResult { file: Blob; audio?: Blob }

export interface Running {
  cancel(): void;
  /** Resolves with the finished files; rejects with the worker's error. Cancel resolves null. */
  done: Promise<RunResult | null>;
}

export interface RunOptions {
  worker: Worker;
  /** The cut's sound, chunk by chunk; null for a silent export. */
  audio?: AsyncIterable<MixChunk> | null;
  onProgress?: (done: number, total: number) => void;
}

let nextId = 1;

/** Runs one job on `worker`; the worker is ended when the job ends. */
export function runJob(job: Job, o: RunOptions): Running {
  const id = nextId++;
  const post = (m: ExportRequest, transfer: Transferable[] = []) => o.worker.postMessage(m, transfer);
  const chunks = o.audio?.[Symbol.asyncIterator]();
  let settled = false;
  let cancel = () => undefined as void;
  const done = new Promise<RunResult | null>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      o.worker.removeEventListener('message', onMessage);
      void chunks?.return?.();
      o.worker.terminate();
      fn();
    };
    cancel = () => {
      post({ type: 'cancel' });
      // The worker answers 'cancelled'; if it is stuck, give up on it after a moment.
      setTimeout(() => finish(() => resolve(null)), 2000);
    };
    const feed = async () => {
      try {
        const next = chunks ? await chunks.next() : { done: true as const, value: undefined };
        if (settled) return;
        if (next.done) post({ type: 'audio', chunk: null });
        else post({ type: 'audio', chunk: next.value }, [...new Set(next.value.data.map((d) => d.buffer as ArrayBuffer))]);
      } catch (error) {
        console.error('Klipkord: could not mix the sound', error);
        post({ type: 'cancel' });
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    };
    const onMessage = (event: MessageEvent<ExportResponse>) => {
      const m = event.data;
      if (m.id !== id) return;
      if (m.type === 'progress') o.onProgress?.(m.done, m.total);
      else if (m.type === 'need-audio') void feed();
      else if (m.type === 'done') finish(() => resolve({ file: m.file, audio: m.audio }));
      else if (m.type === 'cancelled') finish(() => resolve(null));
      else finish(() => reject(new Error(m.message)));
    };
    o.worker.addEventListener('message', onMessage);
    o.worker.addEventListener('error', (event) => finish(() => reject(new Error(event.message || 'Export worker failed'))));
  });
  post({ type: 'start', id, job });
  return { cancel: () => cancel(), done };
}

/** The cut's mix for export (T12's leveling and cleaning included); null when nothing makes a sound. */
export async function cutAudio(project: Project, cut: Cut, words: Word[], blobs: Map<string, Blob>,
  denoise?: (ctx: BaseAudioContext) => Promise<AudioNode>): Promise<{ chunks: AsyncIterable<MixChunk>; dispose(): void } | null> {
  const loader = mediaLoader(async (id) => blobs.get(id) ?? null);
  const mix = await exportMix(mixPlan(project, cut, words), loader, denoise ? { denoise } : {});
  if (!mix) {
    loader.dispose();
    return null;
  }
  return { chunks: mix, dispose: () => loader.dispose() };
}

/** Removes finished exports kept in the extension's storage, except those still listed. */
export async function cleanExports(keep: Set<string>, root: Promise<FileSystemDirectoryHandle> = navigator.storage.getDirectory()): Promise<void> {
  try {
    const dir = await (await root).getDirectoryHandle('exports', { create: true });
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    await Promise.all(names.filter((n) => !keep.has(n)).map((n) => dir.removeEntry(n).catch(() => undefined)));
  } catch (error) {
    console.error('Klipkord: could not clear old exports', error);
  }
}
