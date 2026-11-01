// gifenc is CommonJS; a namespace import also loads where WXT reads entrypoints in Node.
import * as gifenc from 'gifenc';

const { GIFEncoder, applyPalette, quantize } = gifenc;

export interface GifWriter { add(rgba: Uint8ClampedArray): void; finish(): Uint8Array }

/** GIF delays are whole centiseconds: frame i gets the step that keeps the running total on time (15 fps: 7, 6, 7 cs). */
export function gifDelayMs(i: number, fps: number): number {
  return (Math.round(((i + 1) * 100) / fps) - Math.round((i * 100) / fps)) * 10;
}

/** GIF through gifenc: one 256-colour palette per frame, looping forever. */
export function gifWriter(width: number, height: number, fps: number): GifWriter {
  const enc = GIFEncoder();
  let i = 0;
  return {
    add(rgba) {
      const palette = quantize(rgba, 256);
      enc.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: gifDelayMs(i, fps), ...(i === 0 ? { repeat: 0 } : {}) });
      i++;
    },
    finish() { enc.finish(); return enc.bytes(); },
  };
}
