/** v1/v2: 'video' (camera baked in) and 'voice'. v3 adds a file per source; its mic stays 'voice' for the transcript. */
export type Track = 'video' | 'voice' | 'screen' | 'camera' | 'tab';
export const TRACKS: readonly Track[] = ['video', 'voice', 'screen', 'camera', 'tab'];

export interface StorageUsage { usage: number; quota: number }

export interface VideoStore {
  /** Creates `recordings/<id>/`. Safe to call again. */
  open(id: string): Promise<void>;
  /** Appends to the track's open segment; a new segment starts every ROLL_MS so a crash loses at most that much. */
  append(id: string, track: Track, chunk: Blob): Promise<void>;
  /** Commits and closes the recording's open segments. A later append starts a new segment. */
  close(id: string): Promise<void>;
  /** The whole track as one Blob; empty when nothing was written. A v3 recording has no 'video': its screen is read. */
  read(id: string, track: Track, type?: string): Promise<Blob>;
  /** Writes a whole small file, such as events.json, replacing it. */
  put(id: string, name: string, data: Blob): Promise<void>;
  /** Bytes across every track; 0 when the recording has no files. */
  size(id: string): Promise<number>;
  /** Copies every file of `from` into `to` a chunk at a time, so a long recording never sits in memory whole. */
  copy(from: string, to: string): Promise<void>;
  remove(id: string): Promise<void>;
  usage(): Promise<StorageUsage>;
}

export interface VideoStoreDeps {
  root: () => Promise<FileSystemDirectoryHandle>;
  estimate: () => Promise<StorageEstimate>;
  now?: () => number;
}

/** How long one segment file stays open before it is committed and the next one starts. */
export const ROLL_MS = 10_000;

interface Segment { writable: FileSystemWritableFileStream; opened: number }

const isNotFound = (error: unknown) => (error as { name?: string } | null)?.name === 'NotFoundError';

export function createVideoStore({ root, estimate, now = Date.now }: VideoStoreDeps): VideoStore {
  // One writer per track at a time: appends, rolls and closes of the same track run in order.
  const queues = new Map<string, Promise<void>>();
  const open = new Map<string, Segment>();
  // Next segment number per track. Each take has a fresh id, so counting from 0 never overwrites.
  const counts = new Map<string, number>();

  async function dir(id: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    const recordings = await (await root()).getDirectoryHandle('recordings', { create });
    return recordings.getDirectoryHandle(id, { create });
  }

  function enqueue(key: string, step: () => Promise<void>): Promise<void> {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(step);
    queues.set(key, next);
    return next;
  }

  async function commit(key: string): Promise<void> {
    const segment = open.get(key);
    if (!segment) return;
    open.delete(key);
    await segment.writable.close();
  }

  // Each segment is a new file, so committing never copies what was already written.
  async function writeChunk(id: string, track: Track, chunk: Blob): Promise<void> {
    const key = `${id}/${track}`;
    let segment = open.get(key);
    if (segment && now() - segment.opened >= ROLL_MS) {
      await commit(key);
      segment = undefined;
    }
    if (!segment) {
      const n = counts.get(key) ?? 0;
      const file = await (await dir(id, true)).getFileHandle(`${track}.${n}`, { create: true });
      segment = { writable: await file.createWritable(), opened: now() };
      counts.set(key, n + 1);
      open.set(key, segment);
    }
    try {
      await segment.writable.write(chunk);
    } catch (error) {
      // A broken writable fails every later write too, so the next chunk starts a new segment.
      open.delete(key);
      await segment.writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async function copyDir(from: FileSystemDirectoryHandle, to: FileSystemDirectoryHandle): Promise<void> {
    // The DOM typings here lack the async iterator that every browser with OPFS has.
    const entries = (from as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    for await (const [name, handle] of entries) {
      if (handle.kind === 'directory') {
        await copyDir(handle as FileSystemDirectoryHandle, await to.getDirectoryHandle(name, { create: true }));
        continue;
      }
      const reader = (await (handle as FileSystemFileHandle).getFile()).stream().getReader();
      const writable = await (await to.getFileHandle(name, { create: true })).createWritable();
      try {
        for (let part = await reader.read(); !part.done; part = await reader.read()) await writable.write(part.value);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    }
  }

  // Every segment on disk in number order: a gap left by a failed write never hides the segments after it.
  async function files(id: string, track: Track): Promise<File[]> {
    const folder = await dir(id, false);
    const entries = (folder as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    const parts: { n: number; handle: FileSystemFileHandle }[] = [];
    // A file named after the track alone is the single-file layout of earlier builds.
    let legacy: FileSystemFileHandle | null = null;
    const prefix = `${track}.`;
    for await (const [name, handle] of entries) {
      if (handle.kind !== 'file') continue;
      if (name === track) legacy = handle as FileSystemFileHandle;
      else if (name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length))) {
        parts.push({ n: Number(name.slice(prefix.length)), handle: handle as FileSystemFileHandle });
      }
    }
    parts.sort((a, b) => a.n - b.n);
    const handles = legacy ? [legacy, ...parts.map((p) => p.handle)] : parts.map((p) => p.handle);
    return Promise.all(handles.map((h) => h.getFile()));
  }

  const tracks = (id: string) => TRACKS.map((track) => `${id}/${track}`);

  return {
    async open(id) {
      await dir(id, true);
    },
    append(id, track, chunk) {
      return enqueue(`${id}/${track}`, () => writeChunk(id, track, chunk));
    },
    async close(id) {
      await Promise.all(tracks(id).map((key) => enqueue(key, () => commit(key))));
    },
    async read(id, track, type = '') {
      try {
        let parts = await files(id, track);
        // Until the editor plays v3 tracks, screens that play 'video' get the screen recording.
        if (!parts.length && track === 'video') parts = await files(id, 'screen');
        return parts.length === 1 && !type ? parts[0]! : new Blob(parts, { type });
      } catch (error) {
        if (isNotFound(error)) return new Blob([], { type });
        throw error;
      }
    },
    async put(id, name, data) {
      const file = await (await dir(id, true)).getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      await writable.write(data);
      await writable.close();
    },
    async size(id) {
      let total = 0;
      try {
        for (const track of TRACKS) total += (await files(id, track)).reduce((sum, f) => sum + f.size, 0);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return total;
    },
    async copy(from, to) {
      await copyDir(await dir(from, false), await dir(to, true));
    },
    async remove(id) {
      // Not queued: a stuck write must never hold up a delete.
      await Promise.all(tracks(id).map(async (key) => {
        const segment = open.get(key);
        open.delete(key);
        await segment?.writable.abort().catch(() => undefined);
      }));
      try {
        const recordings = await (await root()).getDirectoryHandle('recordings');
        await recordings.removeEntry(id, { recursive: true });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
    async usage() {
      const { usage = 0, quota = 0 } = await estimate();
      return { usage, quota };
    },
  };
}

export const videoStore: VideoStore = createVideoStore({
  root: () => navigator.storage.getDirectory(),
  estimate: () => navigator.storage.estimate(),
});
