import { describe, expect, it, vi } from 'vitest';
import type { MixChunk } from '../audio/export';
import type { ExportRequest, ExportResponse, Job } from './protocol';
import { runJob } from './run';

/** A worker stand-in: records what the page posts and lets the test answer. */
function fakeWorker() {
  const posted: ExportRequest[] = [];
  const listeners = new Set<(e: MessageEvent) => void>();
  const worker = {
    postMessage: (m: ExportRequest) => posted.push(m),
    addEventListener: (type: string, l: (e: MessageEvent) => void) => { if (type === 'message') listeners.add(l); },
    removeEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.delete(l),
    terminate: vi.fn(),
  };
  const answer = (m: ExportResponse) => listeners.forEach((l) => l({ data: m } as MessageEvent));
  return { worker: worker as unknown as Worker, posted, answer, terminate: worker.terminate };
}

const job = { kind: 'still', out: 0 } as unknown as Job;

describe('runJob', () => {
  it('feeds the mix chunk by chunk when the worker asks, then ends it', async () => {
    const w = fakeWorker();
    const chunks: MixChunk[] = [{ timestamp: 0, sampleRate: 48_000, data: [new Float32Array(4), new Float32Array(4)] }];
    const progress: number[] = [];
    const r = runJob(job, { worker: w.worker, audio: (async function* () { yield* chunks; })(), onProgress: (d) => progress.push(d) });
    const start = w.posted[0] as Extract<ExportRequest, { type: 'start' }>;
    expect(start.type).toBe('start');
    w.answer({ type: 'need-audio', id: start.id });
    await vi.waitFor(() => expect(w.posted).toHaveLength(2));
    expect((w.posted[1] as Extract<ExportRequest, { type: 'audio' }>).chunk?.timestamp).toBe(0);
    w.answer({ type: 'need-audio', id: start.id });
    await vi.waitFor(() => expect(w.posted).toHaveLength(3));
    expect(w.posted[2]).toEqual({ type: 'audio', chunk: null });
    w.answer({ type: 'progress', id: start.id, done: 3, total: 9 });
    const file = new Blob(['x']);
    w.answer({ type: 'done', id: start.id, file });
    expect(await r.done).toEqual({ file, audio: undefined });
    expect(progress).toEqual([3]);
    expect(w.terminate).toHaveBeenCalled();
  });

  it('cancels, and fails with the worker\'s message', async () => {
    const a = fakeWorker();
    const r = runJob(job, { worker: a.worker });
    const id = (a.posted[0] as { id: number }).id;
    r.cancel();
    expect(a.posted[1]).toEqual({ type: 'cancel' });
    a.answer({ type: 'cancelled', id });
    expect(await r.done).toBeNull();

    const b = fakeWorker();
    const s = runJob(job, { worker: b.worker });
    b.answer({ type: 'error', id: (b.posted[0] as { id: number }).id, message: 'Chrome ran out of memory' });
    await expect(s.done).rejects.toThrow('Chrome ran out of memory');
  });
});
