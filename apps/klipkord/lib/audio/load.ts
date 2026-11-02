// Reads ranges of a source's sound for export and preview, decoding only what each window plays (never the whole file).
import { openSource, type OpenedSource } from '@appskord/media';
import type { RangeLoader } from './export';

const ids = new WeakMap<Blob, number>();
let nextId = 0;

/** Same key for the same file read again (OPFS hands out a new File each time), new key when it changes. */
export function blobKey(blob: Blob): string {
  if (blob instanceof File) return `${blob.name}|${blob.size}|${blob.lastModified}`;
  let id = ids.get(blob);
  if (id === undefined) ids.set(blob, (id = ++nextId));
  return `#${id}`;
}

/** A RangeLoader over the project's files; `blobOf` gives a source's file now. A source reopens when its file changes. */
export function mediaLoader(blobOf: (source: string) => Promise<Blob | null>): RangeLoader & { dispose(): void } {
  const opened = new Map<string, { key: string; p: Promise<OpenedSource | null> }>();
  const open = async (id: string) => {
    const blob = await blobOf(id);
    const key = blob ? blobKey(blob) : '';
    const was = opened.get(id);
    if (was?.key === key) return was.p;
    if (was) void was.p.then((s) => s?.dispose(), () => {});
    const p = (async () => {
      if (!blob) return null;
      const s = await openSource(blob);
      if (s.audio) return s;
      s.dispose();
      return null;
    })();
    opened.set(id, { key, p });
    return p;
  };
  return {
    async info(id) {
      const s = await open(id);
      return s?.audio ? { duration: s.duration * 1000, sampleRate: s.audio.sampleRate, channels: s.audio.channels } : null;
    },
    async load(id, fromMs, toMs) {
      const s = await open(id);
      if (!s?.audio) return null;
      const { sampleRate: sr, channels } = s.audio;
      const first = Math.round((fromMs * sr) / 1000);
      const n = Math.max(1, Math.round((toMs * sr) / 1000) - first);
      // Decoded straight into the buffer's own channels, so a range is held once.
      const buffer = new AudioBuffer({ length: n, numberOfChannels: channels, sampleRate: sr });
      const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
      for await (const sample of s.audioSamples(fromMs / 1000, toMs / 1000)) {
        try {
          const start = Math.round(sample.timestamp * sr) - first;
          const lo = Math.max(0, -start), hi = Math.min(sample.numberOfFrames, n - start);
          if (hi <= lo) continue;
          for (let c = 0; c < Math.min(channels, sample.numberOfChannels); c++) {
            sample.copyTo(data[c]!.subarray(start + lo, start + hi), { planeIndex: c, format: 'f32-planar', frameOffset: lo, frameCount: hi - lo });
          }
        } finally {
          sample.close();
        }
      }
      return buffer;
    },
    dispose() {
      for (const { p } of opened.values()) void p.then((s) => s?.dispose(), () => {});
      opened.clear();
    },
  };
}
