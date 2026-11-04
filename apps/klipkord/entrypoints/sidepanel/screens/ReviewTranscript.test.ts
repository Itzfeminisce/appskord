import { describe, expect, it, vi } from 'vitest';
import type { Job } from '../components/Retranscribe';
import type { Recording } from '@/lib/types';
import { makeTranscript, type MakeDeps } from './ReviewTranscript';

const rec = { id: 'r1', transcript: [], transcriptDeferred: true } as unknown as Recording;
const seg = [{ start: 0, end: 1000, text: 'hello' }];
const on = () => ({ onStep: vi.fn(), onBytes: vi.fn(), onPct: vi.fn() });
const job = (): Job => ({ stop: () => undefined, stopped: false });

function deps(over: Partial<MakeDeps> = {}): MakeDeps {
  return {
    local: async () => true,
    asked: vi.fn(async () => undefined),
    cached: async () => false,
    download: vi.fn(async (_j, onBytes) => onBytes(18_000_000, 40_000_000)),
    write: vi.fn(async () => seg),
    save: vi.fn(async () => undefined),
    ...over,
  };
}

describe('Make transcript', () => {
  it('records the ask, downloads once, writes and saves the transcript', async () => {
    const d = deps();
    const cb = on();
    expect(await makeTranscript(rec, job(), d, cb)).toBe(true);
    expect(d.asked).toHaveBeenCalled();
    expect(d.download).toHaveBeenCalledTimes(1);
    expect(cb.onBytes).toHaveBeenCalledWith(18_000_000, 40_000_000);
    expect(d.save).toHaveBeenCalledWith('r1', expect.objectContaining({ transcript: seg, transcriptDeferred: false, transcriptPending: false }));
  });

  it('uses the cloud provider with no ask and no download', async () => {
    const d = deps({ local: async () => false });
    expect(await makeTranscript(rec, job(), d, on())).toBe(true);
    expect(d.asked).not.toHaveBeenCalled();
    expect(d.download).not.toHaveBeenCalled();
  });

  it('does not start the download when stopped during the first awaits', async () => {
    const j = job();
    const d = deps({ asked: vi.fn(async () => { j.stopped = true; }) });
    expect(await makeTranscript(rec, j, d, on())).toBe(false);
    expect(d.download).not.toHaveBeenCalled();
  });

  it('skips the download when the model is already there', async () => {
    const d = deps({ cached: async () => true });
    await makeTranscript(rec, job(), d, on());
    expect(d.download).not.toHaveBeenCalled();
    expect(d.write).toHaveBeenCalled();
  });

  it('saves nothing when cancelled or when the download fails', async () => {
    const stopped = { ...job(), stopped: true };
    const d = deps();
    expect(await makeTranscript(rec, stopped, d, on())).toBe(false);
    expect(d.save).not.toHaveBeenCalled();
    const bad = deps({ download: async () => { throw new Error('offline'); } });
    await expect(makeTranscript(rec, job(), bad, on())).rejects.toThrow();
    expect(bad.save).not.toHaveBeenCalled();
  });
});
