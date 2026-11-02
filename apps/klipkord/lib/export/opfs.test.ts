import { describe, expect, it } from 'vitest';
import { drop, hold, stamped, sweep, type Store } from './opfs';

function fakeStore(names: string[], withLocks: boolean, now = 10 * 86_400_000) {
  const files = new Set(names);
  const held = new Set<string>();
  const dir = {
    async *keys() { yield* files; },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
    },
  } as unknown as FileSystemDirectoryHandle;
  const root = { getDirectoryHandle: async () => dir } as unknown as FileSystemDirectoryHandle;
  const locks = {
    async request(name: string, cb: () => Promise<void>) {
      held.add(name);
      await cb();
      held.delete(name);
    },
    query: async () => ({ held: [...held].map((name) => ({ name })) }),
  };
  const store: Store = { root: async () => root, locks: withLocks ? locks : null, now: () => now };
  return { store, files };
}

describe('kept files', () => {
  it('gives two names stamped in the same millisecond different names', () => {
    const { store } = fakeStore([], false);
    expect(stamped(store, 1, 'a.mp4')).not.toBe(stamped(store, 1, 'a.mp4'));
  });

  it('sweeps only files no tab holds', async () => {
    const { store, files } = fakeStore([], true);
    const mine = stamped(store, 1, 'a.mp4');
    files.add(mine).add('5-2-old.mp4');
    const release = await hold(store, 'exports', mine);
    await sweep(store, 'exports');
    expect([...files]).toEqual([mine]);
    await drop(store, 'exports', mine, release);
    expect(files.size).toBe(0);
  });

  it('without Web Locks, sweeps only files over a day old', async () => {
    const day = 86_400_000;
    const { store, files } = fakeStore([`${9 * day}-1-today.mp4`, `${2 * day}-2-old.mp4`], false);
    await sweep(store, 'exports');
    expect([...files]).toEqual([`${9 * day}-1-today.mp4`]);
  });
});
