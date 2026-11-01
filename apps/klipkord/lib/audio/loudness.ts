// BS.1770 loudness: K-weighting, 400 ms gated blocks, integrated LUFS. Pure functions over samples.

export const TARGET_LUFS = -14;
/** Peak ceiling of the limiter, about -1 dBFS. */
export const CEILING = 10 ** (-1 / 20);
const ABSOLUTE_GATE = -70;
const MAX_GAIN_DB = 20;

type Biquad = { b: [number, number, number]; a: [number, number] };

/** The two K-weighting stages (high shelf, then high pass) for any sample rate. */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highPass: Biquad = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, highPass];
}

function filter(input: Float32Array, { b, a }: Biquad): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

const toLufs = (power: number) => -0.691 + 10 * Math.log10(power);

/** Mean K-weighted power of each 400 ms block (75% overlap), summed over channels. */
export function blockPowers(channels: Float32Array[], sampleRate: number, blockMs = 400, hopMs = 100): number[] {
  const len = channels[0]?.length ?? 0;
  const block = Math.round((sampleRate * blockMs) / 1000);
  const hop = Math.round((sampleRate * hopMs) / 1000);
  if (!len || len < block) return [];
  const [shelf, highPass] = kWeighting(sampleRate);
  // Prefix sums of squared weighted samples make every block O(1).
  const sums = channels.map((ch) => {
    const w = filter(filter(ch, shelf), highPass);
    const sum = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) sum[i + 1] = sum[i]! + w[i]! * w[i]!;
    return sum;
  });
  const powers: number[] = [];
  for (let start = 0; start + block <= len; start += hop) {
    let p = 0;
    for (const sum of sums) p += (sum[start + block]! - sum[start]!) / block;
    powers.push(p);
  }
  return powers;
}

/** Gated mean of 400 ms block powers (absolute -70 LUFS, then relative -10 LU) in LUFS; -Infinity when none pass. */
function gated(blocks: number[]): number {
  const powers = blocks.filter((p) => p > 0 && toLufs(p) > ABSOLUTE_GATE);
  if (!powers.length) return -Infinity;
  const relative = toLufs(powers.reduce((s, p) => s + p, 0) / powers.length) - 10;
  const kept = powers.filter((p) => toLufs(p) > relative);
  return toLufs(kept.reduce((s, p) => s + p, 0) / kept.length);
}

/** Integrated loudness in LUFS; -Infinity for silence or audio shorter than one block. */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  return gated(blockPowers(channels, sampleRate));
}

/**
 * Integrated loudness of audio fed in pieces: K-weighting state carries across pushes and only the power of each
 * 100 ms hop is kept, so a long export meters in a few kilobytes.
 */
export class LoudnessMeter {
  private readonly stages: Biquad[];
  private readonly state: Float64Array[];   // per channel: x1, x2, y1, y2 of each stage
  private readonly hop: number;
  private sum = 0;
  private filled = 0;
  private readonly hops: number[] = [];

  constructor(sampleRate: number, channels: number) {
    this.stages = kWeighting(sampleRate);
    this.state = Array.from({ length: channels }, () => new Float64Array(8));
    this.hop = Math.round(sampleRate / 10);
  }

  push(channels: Float32Array[]): void {
    const len = channels[0]?.length ?? 0;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.state.length; c++) {
        const st = this.state[c]!;
        let x = channels[c]?.[i] ?? 0;
        for (let k = 0; k < 2; k++) {
          const { b, a } = this.stages[k]!, o = k * 4;
          const y = b[0] * x + b[1] * st[o]! + b[2] * st[o + 1]! - a[0] * st[o + 2]! - a[1] * st[o + 3]!;
          st[o + 1] = st[o]!; st[o] = x; st[o + 3] = st[o + 2]!; st[o + 2] = y;
          x = y;
        }
        this.sum += x * x;
      }
      if (++this.filled === this.hop) {
        this.hops.push(this.sum);
        this.sum = 0;
        this.filled = 0;
      }
    }
  }

  /** Integrated loudness of everything pushed so far, in LUFS. */
  integrated(): number {
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= this.hops.length; i++) blocks.push((this.hops[i]! + this.hops[i + 1]! + this.hops[i + 2]! + this.hops[i + 3]!) / (4 * this.hop));
    return gated(blocks);
  }
}

/** Momentary loudness (400 ms) every 100 ms, for the loudness meter. */
export function momentaryLoudness(channels: Float32Array[], sampleRate: number): number[] {
  return blockPowers(channels, sampleRate).map((p) => (p > 0 ? toLufs(p) : -Infinity));
}

/** Linear gain that brings `lufs` to the target; 1 for silence, never more than +20 dB. */
export function gainTo(lufs: number, target = TARGET_LUFS): number {
  if (!Number.isFinite(lufs)) return 1;
  return 10 ** (Math.min(MAX_GAIN_DB, target - lufs) / 20);
}

/**
 * Streaming look-ahead peak limiter. The gain glides down across the look-ahead window (a moving average of the
 * lowest gain needed ahead), so it reaches what a peak needs as the peak arrives, then recovers over `releaseMs`.
 * Output lags input by the look-ahead; `flush` returns the held tail.
 */
export class Limiter {
  private readonly look: number;
  private readonly release: number;
  private readonly need: Float32Array;      // ring, by input index
  private readonly held: Float32Array[];    // ring of delayed input samples
  private readonly avg: Float32Array;       // ring of smoothed gains being averaged
  private readonly deque: number[] = [];    // input indices of rising need, for the minimum ahead
  private sum: number;
  private smooth = 1;
  private n = 0;                            // input samples taken

  constructor(sampleRate: number, private readonly channels: number, private readonly ceiling = CEILING, lookMs = 5, releaseMs = 80) {
    this.look = Math.max(1, Math.round((sampleRate * lookMs) / 1000));
    this.release = 1 - Math.exp(-1 / ((sampleRate * releaseMs) / 1000));
    this.need = new Float32Array(this.look + 1);
    this.held = Array.from({ length: channels }, () => new Float32Array(this.look + 1));
    this.avg = new Float32Array(this.look).fill(1);
    this.sum = this.look;
  }

  /** Takes input samples and returns the output samples now ready (the first call returns `look` fewer). */
  process(input: Float32Array[]): Float32Array[] {
    const len = input[0]?.length ?? 0;
    const ready = Math.max(0, Math.min(len, this.n + len - this.look));
    const out = Array.from({ length: this.channels }, () => new Float32Array(ready));
    let k = 0;
    for (let i = 0; i < len; i++) {
      let peak = 0;
      for (let c = 0; c < this.channels; c++) peak = Math.max(peak, Math.abs(input[c]?.[i] ?? 0));
      k = this.step(peak, (c) => input[c]?.[i] ?? 0, out, k);
    }
    return out;
  }

  /** The output still held back, as though silence followed. */
  flush(): Float32Array[] {
    const ready = Math.min(this.look, this.n);
    const out = Array.from({ length: this.channels }, () => new Float32Array(ready));
    let k = 0;
    for (let i = 0; i < ready; i++) k = this.step(0, () => 0, out, k);
    return out;
  }

  private step(peak: number, sample: (c: number) => number, out: Float32Array[], k: number): number {
    const { look, need, deque } = this;
    const n = this.n++;
    const slot = n % (look + 1);
    need[slot] = peak > this.ceiling ? this.ceiling / peak : 1;
    for (let c = 0; c < this.channels; c++) this.held[c]![slot] = sample(c);
    while (deque.length && need[deque[deque.length - 1]! % (look + 1)]! >= need[slot]!) deque.pop();
    deque.push(n);
    const m = n - look;
    if (m < 0) return k;
    while (deque[0]! < m) deque.shift();
    const ahead = need[deque[0]! % (look + 1)]!;
    this.smooth = ahead < this.smooth ? ahead : this.smooth + (ahead - this.smooth) * this.release;
    const a = m % look;
    this.sum += this.smooth - this.avg[a]!;
    this.avg[a] = this.smooth;
    // The average is at most what sample m needs, except in the first look-ahead, which the min covers.
    const g = Math.min(this.sum / look, need[m % (look + 1)]!);
    for (let c = 0; c < this.channels; c++) out[c]![k] = this.held[c]![m % (look + 1)]! * g;
    return k + 1;
  }
}

/** Look-ahead peak limiter over a whole buffer, in place: no sample of any channel passes `ceiling`. */
export function limit(channels: Float32Array[], sampleRate: number, ceiling = CEILING, lookMs = 5, releaseMs = 80): void {
  const l = new Limiter(sampleRate, channels.length, ceiling, lookMs, releaseMs);
  const head = l.process(channels);
  const tail = l.flush();
  channels.forEach((ch, c) => {
    ch.set(head[c]!, 0);
    ch.set(tail[c]!, head[c]!.length);
  });
}

/** Measures, applies the gain to reach the target and limits peaks, in place. */
export function level(channels: Float32Array[], sampleRate: number, target = TARGET_LUFS): { before: number; gain: number } {
  const before = integratedLoudness(channels, sampleRate);
  const gain = gainTo(before, target);
  if (gain !== 1) for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
  limit(channels, sampleRate);
  return { before, gain };
}
