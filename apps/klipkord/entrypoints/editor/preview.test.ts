import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_WAIT_MS, workerPreview } from './preview';

function fakeWorker() {
  const listeners = new Set<(e: MessageEvent) => void>();
  const posted: string[] = [];
  const worker = {
    postMessage: (m: { type: string }) => void posted.push(m.type),
    addEventListener: (_: string, l: (e: MessageEvent) => void) => void listeners.add(l),
    terminate: vi.fn(),
    answer: (data: unknown) => listeners.forEach((l) => l({ data } as MessageEvent)),
  };
  return { worker, posted };
}
const canvas = { transferControlToOffscreen: () => ({}) } as unknown as HTMLCanvasElement;

afterEach(() => vi.useRealTimers());

describe('preview worker', () => {
  it('close asks the worker to let go and ends it once it answers', () => {
    const { worker, posted } = fakeWorker();
    workerPreview(worker as unknown as Worker, canvas, []).close();
    expect(posted).toEqual(['init', 'close']);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.answer({ type: 'closed' });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('ends a worker that does not answer after a short wait', () => {
    vi.useFakeTimers();
    const { worker } = fakeWorker();
    workerPreview(worker as unknown as Worker, canvas, []).close();
    vi.advanceTimersByTime(CLOSE_WAIT_MS);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
