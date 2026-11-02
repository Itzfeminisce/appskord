// Files Klipkord keeps for a while in the extension's own storage: exports waiting on their download or Drive
// upload, and the side panel's joined copy of a v3 recording. A tab holds a Web Lock on each file it uses, so
// another tab's sweep never removes it.

const LOCK = 'klipkord-file:';
const DAY = 86_400_000;

interface Locks {
  request(name: string, callback: () => Promise<void>): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[]; pending?: { name?: string }[] }>;
}

export interface Store {
  root(): Promise<FileSystemDirectoryHandle>;
  locks: Locks | null;
  now(): number;
}

export const browserStore: Store = {
  root: () => navigator.storage.getDirectory(),
  locks: (globalThis.navigator as Navigator | undefined)?.locks ?? null,
  now: () => Date.now(),
};

export const folder = async (store: Store, dir: string): Promise<FileSystemDirectoryHandle> =>
  (await store.root()).getDirectoryHandle(dir, { create: true });

/** "1730505600000-3-Invite your team.mp4": the time lets a sweep without Web Locks tell its age. */
export const stamped = (store: Store, seq: number, name: string): string => `${store.now()}-${seq}-${name}`;

/** Takes this tab's lock on `dir/name`; resolves once it is held, with the function that lets it go. */
export async function hold(store: Store, dir: string, name: string): Promise<() => void> {
  if (!store.locks) return () => undefined;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await new Promise<void>((granted) => {
    store.locks!.request(`${LOCK}${dir}/${name}`, () => {
      granted();
      return held;
    }).catch((error: unknown) => {
      console.error('Klipkord: could not hold a kept file', error);
      granted();
    });
  });
  return release;
}

/** Removes `dir/name`, then lets its lock go. */
export async function drop(store: Store, dir: string, name: string, release?: () => void): Promise<void> {
  try {
    await (await folder(store, dir)).removeEntry(name);
  } catch (error) {
    if ((error as { name?: string }).name !== 'NotFoundError') console.error('Klipkord: could not remove a kept file', error);
  } finally {
    release?.();
  }
}

/** Startup sweep: removes files no open tab holds; without Web Locks, only those over a day old. */
export async function sweep(store: Store, dir: string): Promise<void> {
  try {
    const d = await folder(store, dir);
    const names: string[] = [];
    for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    const snapshot = store.locks ? await store.locks.query() : null;
    const busy = new Set([...(snapshot?.held ?? []), ...(snapshot?.pending ?? [])].map((l) => l.name));
    const now = store.now();
    const stale = names.filter((n) => {
      if (snapshot) return !busy.has(`${LOCK}${dir}/${n}`);
      const at = Number(n.split('-')[0]);
      return Number.isFinite(at) && now - at > DAY;
    });
    await Promise.all(stale.map((n) => d.removeEntry(n).catch(() => undefined)));
  } catch (error) {
    console.error('Klipkord: could not clear old files', error);
  }
}
