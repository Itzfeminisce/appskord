import { describe, expect, it } from 'vitest';
import { exportMix, unloop, type MixChunk, type RangeLoader } from './export';
import { integratedLoudness, TARGET_LUFS } from './loudness';
import type { MixPlan } from './mix';

// A tiny sample-by-sample Web Audio renderer: buffer sources, gains with set/linear-ramp automation, summing.
type Ev = { ramp: boolean; v: number; t: number };
class Param {
  evs: Ev[] = [];
  constructor(public value: number) {}
  setValueAtTime(v: number, t: number) { this.evs.push({ ramp: false, v, t }); }
  linearRampToValueAtTime(v: number, t: number) { this.evs.push({ ramp: true, v, t }); }
  at(t: number) {
    let pt = 0, pv = this.value;
    for (const e of this.evs) {
      if (e.t <= t) [pt, pv] = [e.t, e.v];
      else return e.ramp ? pv + ((e.v - pv) * (t - pt)) / (e.t - pt) : pv;
    }
    return pv;
  }
}
class Node {
  inputs: Node[] = [];
  connect<T extends Node>(n: T): T { n.inputs.push(this); return n; }
  disconnect() {}
  out(t: number): number { return this.inputs.reduce((s, n) => s + n.out(t), 0); }
}
class Gain extends Node {
  gain = new Param(1);
  override out(t: number) { return super.out(t) * this.gain.at(t); }
}
const fakeBuffer = (data: Float32Array[], sampleRate: number) => ({
  sampleRate, length: data[0]!.length, numberOfChannels: data.length, duration: data[0]!.length / sampleRate,
  getChannelData: (c: number) => data[c]!, copyToChannel: (d: Float32Array, c: number) => data[c]!.set(d),
}) as unknown as AudioBuffer;
class Source extends Node {
  buffer: AudioBuffer | null = null;
  loop = false;
  playbackRate = { value: 1 };
  private span: [number, number, number] | null = null;
  start(at: number, offset: number, duration: number) { this.span = [at, offset, duration]; }
  override out(t: number) {
    if (!this.span || !this.buffer || t < this.span[0]) return 0;
    const played = (t - this.span[0]) * this.playbackRate.value;
    if (played >= this.span[2]) return 0;
    const x = (this.span[1] + played) * this.buffer.sampleRate, i = Math.floor(x), f = x - i;
    const d = this.buffer.getChannelData(0);
    return (d[i] ?? 0) * (1 - f) + (d[i + 1] ?? 0) * f;
  }
}
const createContext = (channels: number, length: number, sampleRate: number) => {
  const destination = new Node();
  return {
    destination, sampleRate, currentTime: 0,
    createGain: () => new Gain(),
    createBufferSource: () => new Source(),
    createBuffer: (ch: number, n: number, sr: number) => fakeBuffer(Array.from({ length: ch }, () => new Float32Array(n)), sr),
    startRendering: async () => {
      const data = Float32Array.from({ length }, (_, i) => destination.out(i / sampleRate));
      return fakeBuffer(Array.from({ length: channels }, () => data.slice()), sampleRate);
    },
  } as unknown as OfflineAudioContext;
};

const SR = 8000;
const tone = (seconds: number, f: number) => Float32Array.from({ length: seconds * SR }, (_, i) =>
  0.3 * Math.sin((2 * Math.PI * f * i) / SR) + 0.1 * Math.sin((2 * Math.PI * f * 2.7 * i) / SR));
const files: Record<string, Float32Array> = { mic: tone(4, 180), song: tone(1.3, 330) };
function loader(spans: number[] = []): RangeLoader {
  return {
    info: async (id) => (files[id] ? { duration: (files[id].length / SR) * 1000, sampleRate: SR, channels: 1 } : null),
    load: async (id, from, to) => {
      const f = files[id]!, first = Math.round((from * SR) / 1000), n = Math.max(1, Math.round((to * SR) / 1000) - first);
      spans.push(to - from);
      return fakeBuffer([Float32Array.from({ length: n }, (_, i) => f[first + i] ?? 0)], SR);
    },
  };
}
const plan: MixPlan = {
  length: 3000, denoise: false, level: false,
  parts: [
    { track: 'voice', source: 'mic', when: 0, from: 0, length: 1200, rate: 1, gain: 1 },
    { track: 'voice', source: 'mic', when: 1200, from: 2000, length: 800, rate: 2, gain: 1, natural: true },
    { track: 'voice', source: 'mic', when: 2000, from: 500, length: 1000, rate: 1.5, gain: 0.8 },
    { track: 'music', source: 'song', when: 0, from: 0, length: 3000, rate: 1, gain: 0.3, loop: true },
    { track: 'tab', source: 'missing', when: 0, from: 0, length: 3000, rate: 1, gain: 1 },
  ],
  music: { fade: [{ t: 0, gain: 0 }, { t: 500, gain: 1 }, { t: 2500, gain: 1 }, { t: 3000, gain: 0 }], duck: [] },
};
async function render(p: MixPlan, windowMs: number, spans?: number[]) {
  const chunks = await exportMix(p, loader(spans), { sampleRate: SR, channels: 1, windowMs, prerollMs: 300, createContext });
  const all: MixChunk[] = [];
  for await (const c of chunks!) all.push(c);
  const out = new Float32Array(all.reduce((n, c) => n + c.data[0]!.length, 0));
  for (const c of all) out.set(c.data[0]!, Math.round(c.timestamp * SR));
  return { out, all };
}
const maxDiff = (a: Float32Array, b: Float32Array) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i]!)), 0);

describe('chunked export mix', () => {
  it('splits looping music into back-to-back pieces that fade only at the outer ends', () => {
    const pieces = unloop([plan.parts[3]!], new Map([['song', { duration: 1300, sampleRate: SR, channels: 1 }]]));
    expect(pieces.map((p) => [p.when, p.from, p.length, p.seams])).toEqual([
      [0, 0, 1300, { start: false, end: true }], [1300, 0, 1300, { start: true, end: true }], [2600, 0, 400, { start: true, end: false }],
    ]);
  });

  it('renders in chunks to what one pass renders, reading only each chunk\'s ranges', async () => {
    const spans: number[] = [];
    const chunked = await render(plan, 700, spans);
    const single = await render(plan, 10_000);
    expect(chunked.all.length).toBe(5);
    expect(chunked.out).toHaveLength(3 * SR);
    expect(maxDiff(chunked.out, single.out)).toBeLessThan(1e-4);
    expect(Math.max(...chunked.out.map(Math.abs))).toBeGreaterThan(0.1);
    expect(Math.max(...spans)).toBeLessThan(2200);
  });

  it('levels in two streaming passes to the target, the same chunked or not', async () => {
    const level = { ...plan, level: true };
    const chunked = await render(level, 700);
    const single = await render(level, 10_000);
    expect(chunked.out).toHaveLength(3 * SR);
    expect(maxDiff(chunked.out, single.out)).toBeLessThan(1e-3);
    expect(integratedLoudness([chunked.out], SR)).toBeCloseTo(TARGET_LUFS, 0);
  });

  it('has nothing to export when no source can be read', async () => {
    expect(await exportMix({ ...plan, parts: [plan.parts[4]!] }, loader(), { createContext })).toBeNull();
  });
});
