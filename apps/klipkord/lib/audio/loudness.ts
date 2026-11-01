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

/** Integrated loudness in LUFS; -Infinity for silence or audio shorter than one block. */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const powers = blockPowers(channels, sampleRate).filter((p) => p > 0 && toLufs(p) > ABSOLUTE_GATE);
  if (!powers.length) return -Infinity;
  const relative = toLufs(powers.reduce((s, p) => s + p, 0) / powers.length) - 10;
  const gated = powers.filter((p) => toLufs(p) > relative);
  return toLufs(gated.reduce((s, p) => s + p, 0) / gated.length);
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

/** Look-ahead peak limiter, in place: no sample of any channel passes `ceiling`. */
export function limit(channels: Float32Array[], sampleRate: number, ceiling = CEILING, lookMs = 5, releaseMs = 80): void {
  const len = channels[0]?.length ?? 0;
  if (!len) return;
  const look = Math.max(1, Math.round((sampleRate * lookMs) / 1000));
  const need = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let peak = 0;
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]!));
    need[i] = peak > ceiling ? ceiling / peak : 1;
  }
  // Each sample takes the lowest gain needed within the look-ahead, so the gain is down before the peak arrives.
  const ahead = new Float32Array(len);
  const deque: number[] = [];
  let head = 0;
  for (let i = len - 1; i >= 0; i--) {
    while (deque.length > head && need[deque[deque.length - 1]!]! >= need[i]!) deque.pop();
    deque.push(i);
    while (deque[head]! > i + look) head++;
    ahead[i] = need[deque[head]!]!;
  }
  const release = 1 - Math.exp(-1 / ((sampleRate * releaseMs) / 1000));
  let g = 1;
  for (let i = 0; i < len; i++) {
    const want = ahead[i]!;
    g = want < g ? want : g + (want - g) * release;
    for (const ch of channels) ch[i]! *= g;
  }
}

/** Measures, applies the gain to reach the target and limits peaks, in place. */
export function level(channels: Float32Array[], sampleRate: number, target = TARGET_LUFS): { before: number; gain: number } {
  const before = integratedLoudness(channels, sampleRate);
  const gain = gainTo(before, target);
  if (gain !== 1) for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
  limit(channels, sampleRate);
  return { before, gain };
}
