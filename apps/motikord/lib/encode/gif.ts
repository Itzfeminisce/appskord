// gifenc is CommonJS; a namespace import also loads where WXT reads entrypoints in Node.
import * as gifenc from 'gifenc';

const { GIFEncoder, applyPalette, quantize } = gifenc;

export interface GifWriter { add(rgba: Uint8ClampedArray): void; finish(): Uint8Array }

/** GIF through gifenc: one 256-colour palette per frame, looping forever. */
export function gifWriter(width: number, height: number, fps: number): GifWriter {
  const enc = GIFEncoder();
  const delay = Math.round(1000 / fps);
  let first = true;
  return {
    add(rgba) {
      const palette = quantize(rgba, 256);
      enc.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay, ...(first ? { repeat: 0 } : {}) });
      first = false;
    },
    finish() { enc.finish(); return enc.bytes(); },
  };
}
