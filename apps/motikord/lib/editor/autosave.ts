import type { Clip } from '../types';

export type SaveStatus = 'saved' | 'saving' | 'failed';

export interface AutosaveOptions {
  write: (clip: Clip) => Promise<void>;
  onStatus: (status: SaveStatus, error?: unknown) => void;
  /** Wait after the last change before writing, so a burst of edits is one write. */
  delayMs?: number;
  /** After a failed write, try again on its own after this long ("Motikord will save again"). */
  retryMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface Autosave {
  /** Call after every change with the clip as it now is. */
  schedule(clip: Clip): void;
  /** Writes the pending clip now (tab hidden, Try again). Resolves when the write settles. */
  flush(): Promise<void>;
  dispose(): void;
}

export function createAutosave(o: AutosaveOptions): Autosave {
  const delay = o.delayMs ?? 400;
  const retry = o.retryMs ?? 10_000;
  const set = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clear = o.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let pending: Clip | undefined;
  let timer: unknown;
  let writing: Promise<void> | undefined;
  let disposed = false;

  const arm = (ms: number) => {
    if (timer !== undefined) clear(timer);
    timer = set(() => { timer = undefined; void flush(); }, ms);
  };

  async function flush(): Promise<void> {
    if (timer !== undefined) { clear(timer); timer = undefined; }
    if (writing) await writing;
    const clip = pending;
    if (!clip || disposed) return;
    pending = undefined;
    o.onStatus('saving');
    writing = o.write(clip).then(
      () => { if (!pending) o.onStatus('saved'); },
      (error: unknown) => {
        // Keep the newest clip so the next try writes it.
        pending ??= clip;
        o.onStatus('failed', error);
        if (!disposed) arm(retry);
      },
    ).finally(() => { writing = undefined; });
    await writing;
  }

  return {
    schedule(clip) {
      if (disposed) return;
      pending = clip;
      o.onStatus('saving');
      arm(delay);
    },
    flush,
    dispose() {
      disposed = true;
      if (timer !== undefined) clear(timer);
    },
  };
}

