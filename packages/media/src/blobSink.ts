import type { StreamTargetChunk } from 'mediabunny';

export interface BlobSink {
  writable: WritableStream<StreamTargetChunk>;
  /** The written file; call after the output is finalized. */
  blob(type: string): Blob;
}

/** Collects a StreamTarget's positioned writes as Blob parts, so the browser can keep the file off the JS heap. */
export function blobSink(): BlobSink {
  let parts: { at: number; blob: Blob }[] = [];
  let end = 0;
  return {
    writable: new WritableStream<StreamTargetChunk>({
      write({ data, position }) {
        const blob = new Blob([data]);
        if (position >= end) {
          if (position > end) parts.push({ at: end, blob: new Blob([new Uint8Array(position - end)]) });
          parts.push({ at: position, blob });
          end = position + blob.size;
          return;
        }
        // A patch of earlier bytes (a size or index written back): splice it over what it covers.
        const stop = position + blob.size;
        const next: typeof parts = [];
        for (const p of parts) {
          const pEnd = p.at + p.blob.size;
          if (pEnd <= position || p.at >= stop) {
            next.push(p);
            continue;
          }
          if (p.at < position) next.push({ at: p.at, blob: p.blob.slice(0, position - p.at) });
          if (position >= p.at) next.push({ at: position, blob });
          if (pEnd > stop) next.push({ at: stop, blob: p.blob.slice(stop - p.at) });
        }
        parts = next;
        end = Math.max(end, stop);
      },
    }),
    blob: (type) =>
      new Blob(
        parts.map((p) => p.blob),
        { type },
      ),
  };
}
