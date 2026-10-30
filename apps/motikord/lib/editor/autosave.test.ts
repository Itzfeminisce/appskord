import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip } from '../types';
import { createAutosave, type SaveStatus } from './autosave';

const clip = (n: number) => ({ id: 'c', updatedAt: n }) as unknown as Clip;

describe('autosave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('writes once after a burst of changes, with the newest clip', async () => {
    const write = vi.fn(async (_c: Clip) => undefined);
    const statuses: SaveStatus[] = [];
    const a = createAutosave({ write, onStatus: (s) => statuses.push(s), delayMs: 300 });
    a.schedule(clip(1));
    await vi.advanceTimersByTimeAsync(200);
    a.schedule(clip(2));
    await vi.advanceTimersByTimeAsync(200);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]![0].updatedAt).toBe(2);
    expect(statuses.at(-1)).toBe('saved');
  });

  it('reports a failed write, keeps the clip and saves it again on its own', async () => {
    let fail = true;
    const write = vi.fn(async () => { if (fail) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); });
    const statuses: SaveStatus[] = [];
    const a = createAutosave({ write, onStatus: (s) => statuses.push(s), delayMs: 100, retryMs: 5000 });
    a.schedule(clip(1));
    await vi.advanceTimersByTimeAsync(100);
    expect(statuses.at(-1)).toBe('failed');
    fail = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('saved');
  });

  it('flush writes now, and Try again after a failure', async () => {
    let fail = true;
    const write = vi.fn(async () => { if (fail) throw new Error('no'); });
    const statuses: SaveStatus[] = [];
    const a = createAutosave({ write, onStatus: (s) => statuses.push(s), delayMs: 1000, retryMs: 60_000 });
    a.schedule(clip(1));
    await a.flush();
    expect(statuses.at(-1)).toBe('failed');
    fail = false;
    await a.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('saved');
    a.dispose();
    a.schedule(clip(2));
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
