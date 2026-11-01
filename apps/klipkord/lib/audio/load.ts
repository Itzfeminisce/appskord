// Reads ranges of a source's sound for the export, decoding only what each chunk plays (never the whole file).
import { openSource, type OpenedSource } from '@appskord/media';
import type { RangeLoader } from './export';

/** A RangeLoader over the project's files; `blobOf` gives a source's file. Dispose when the export ends. */
export function mediaLoader(blobOf: (source: string) => Promise<Blob | null>): RangeLoader & { dispose(): void } {
  const opened = new Map<string, Promise<OpenedSource | null>>();
  const open = (id: string) => {
    let p = opened.get(id);
    if (!p) {
      p = blobOf(id).then(async (blob) => {
        if (!blob) return null;
        const s = await openSource(blob);
        if (s.audio) return s;
        s.dispose();
        return null;
      });
      opened.set(id, p);
    }
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
      const data = Array.from({ length: channels }, () => new Float32Array(n));
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
      const buffer = new AudioBuffer({ length: n, numberOfChannels: channels, sampleRate: sr });
      data.forEach((d, c) => buffer.copyToChannel(d, c));
      return buffer;
    },
    dispose() {
      for (const p of opened.values()) void p.then((s) => s?.dispose(), () => {});
      opened.clear();
    },
  };
}
