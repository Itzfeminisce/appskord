// "Keep the voice natural": WSOLA time-stretch, which changes duration and keeps pitch. Pure functions over samples.

/** Input samples from `start`; reads outside `data` are silence. */
export interface InputWindow { start: number; data: Float32Array[] }

/**
 * Streaming WSOLA: output comes out in order, one hop (half a 20 ms frame) at a time, from an input window the
 * caller keeps loaded (`needs` says which). Each frame is taken from up to ±10 ms around where `rate` puts it, at the
 * offset that best continues the last frame, then overlap-added under a Hann window.
 */
export class Stretcher {
  readonly hop: number;
  private readonly search: number;
  private readonly window: Float32Array;
  private block = 0;        // next output hop
  private pos = 0;          // input sample the last frame's second half starts at
  private pending: Float32Array[] | null = null;

  constructor(readonly rate: number, sampleRate: number, readonly channels: number, frameMs = 20, searchMs = 10) {
    this.hop = Math.max(8, Math.round((sampleRate * frameMs) / 2000));
    this.search = Math.round((sampleRate * searchMs) / 1000);
    this.window = Float32Array.from({ length: 2 * this.hop }, (_, i) => 0.5 - 0.5 * Math.cos((Math.PI * i) / this.hop));
  }

  /** Output samples made so far. */
  get made(): number {
    return this.block * this.hop;
  }

  private ideal(frame: number): number {
    return Math.round(frame * this.hop * this.rate);
  }

  /** The input range [from, to) the next `blocks` hops read. */
  needs(blocks: number): [number, number] {
    const from = this.pending ? Math.min(this.pos, this.ideal(this.block + 1) - this.search - this.hop) : -this.hop;
    return [from, this.ideal(this.block + blocks) + this.search + this.hop];
  }

  /** Makes the next `blocks` hops of output from `input`, which must cover `needs(blocks)`. */
  next(input: InputWindow, blocks: number): Float32Array<ArrayBuffer>[] {
    const { hop, window } = this;
    const out = Array.from({ length: this.channels }, () => new Float32Array(blocks * hop));
    const at = (c: number, i: number) => input.data[c]?.[i - input.start] ?? 0;
    if (!this.pending) {
      // Frame 0 sits at input 0; its first half falls before the output starts.
      this.pending = out.map((_, c) => Float32Array.from({ length: hop }, (_, t) => at(c, t) * window[hop + t]!));
    }
    for (let b = 0; b < blocks; b++) {
      const p = this.best(at, this.ideal(this.block + 1));
      for (let c = 0; c < this.channels; c++) {
        const o = out[c]!, prev = this.pending[c]!;
        for (let t = 0; t < hop; t++) {
          o[b * hop + t] = prev[t]! + at(c, p - hop + t) * window[t]!;
          prev[t] = at(c, p + t) * window[hop + t]!;
        }
      }
      this.pos = p;
      this.block++;
    }
    return out;
  }

  /** The frame centre near `ideal` whose first half best matches what follows the last frame (coarse, then fine). */
  private best(at: (c: number, i: number) => number, ideal: number): number {
    const { hop, search, pos } = this;
    const score = (p: number, step: number) => {
      let s = 0;
      for (let t = 0; t < hop; t += step) for (let c = 0; c < this.channels; c++) s += at(c, p - hop + t) * at(c, pos + t);
      return s;
    };
    let best = ideal, top = -Infinity;
    for (let d = -search; d <= search; d += 4) {
      const s = score(ideal + d, 4);
      if (s > top) [top, best] = [s, ideal + d];
    }
    const coarse = best;
    top = -Infinity;
    for (let d = -3; d <= 3; d++) {
      if (Math.abs(coarse + d - ideal) > search) continue;
      const s = score(coarse + d, 2);
      if (s > top) [top, best] = [s, coarse + d];
    }
    return best;
  }
}

/** Plays `channels` `rate` times faster (0.5 = twice as long) at the same pitch. */
export function stretch(channels: Float32Array[], rate: number, sampleRate: number): Float32Array<ArrayBuffer>[] {
  const length = Math.round((channels[0]?.length ?? 0) / rate);
  const s = new Stretcher(rate, sampleRate, channels.length);
  const blocks = Math.ceil(length / s.hop);
  return s.next({ start: 0, data: channels }, blocks).map((c) => c.slice(0, length));
}
