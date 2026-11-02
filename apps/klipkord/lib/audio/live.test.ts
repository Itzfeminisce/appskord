import { describe, expect, it, vi } from 'vitest';
import type { RangeLoader } from './export';
import { estimateLoudness, liveMix, WINDOW_MS } from './live';
import type { MixPlan } from './mix';

// A Web Audio stand-in that records which sources start, when, where and for how long.
function fakeContext() {
  const started: { at: number; offset: number; duration: number }[] = [];
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  const param = () => ({ value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} });
  const calls: string[] = [];
  const ctx = {
    currentTime: 0, state: 'running', destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createWaveShaper: () => ({ ...node(), curve: null, oversample: 'none' }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, playbackRate: { value: 1 },
      start: (at: number, offset: number, duration: number) => started.push({ at, offset, duration }), stop: () => {} }),
    resume: async () => { calls.push('resume'); },
    suspend: async () => { calls.push('suspend'); },
    close: async () => {},
  };
  return { ctx: ctx as unknown as AudioContext, started, calls };
}

// 10 s mono files of a 1 kHz tone; each read hands back just the range asked for.
const loader = (seconds = 10): RangeLoader => ({
  info: vi.fn(async () => ({ duration: seconds * 1000, sampleRate: 48_000, channels: 1 })),
  load: vi.fn(async (_id: string, from: number, to: number) => {
    const n = Math.round(((to - from) * 48_000) / 1000);
    return { duration: n / 48_000, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * (i + (from * 48))) / 48_000)) } as unknown as AudioBuffer;
  }),
});

const plan = (patch: Partial<MixPlan> = {}): MixPlan => ({
  length: 5000, music: null, denoise: false, level: false,
  parts: [{ track: 'voice', source: 'mic', when: 0, from: 0, length: 5000, rate: 1, gain: 1 }],
  ...patch,
});

const settle = () => new Promise((r) => setTimeout(r, 0));
const rnnoise = () => ({ connect: (n: unknown) => n, disconnect: vi.fn(), destroy: vi.fn() });

describe('live mix', () => {
  it('plays from where the playhead is once the sound is ready, and never loads noise removal unless asked', async () => {
    const { ctx, started } = fakeContext();
    const denoise = vi.fn();
    const files = loader();
    const live = liveMix({ context: () => ctx, loader: files, denoise });
    live.play(plan(), () => 1000);
    await settle();
    // 50 ms ahead of the playhead, matching the 50 ms scheduling lead; only the part from the playhead is read.
    expect(started).toHaveLength(1);
    expect(started[0]!.at).toBeCloseTo(0.05);
    expect(started[0]!.duration).toBeCloseTo(3.95);
    expect(files.load).toHaveBeenCalledWith('mic', 980, 5020);
    expect(denoise).not.toHaveBeenCalled();
  });

  it('reads a long cut a window at a time, each window stopping where the next starts', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, started } = fakeContext();
      const files = loader(60);
      const live = liveMix({ context: () => ctx, loader: files, denoise: vi.fn() });
      const long = plan({ length: 60_000, parts: [{ track: 'voice', source: 'mic', when: 0, from: 0, length: 60_000, rate: 1, gain: 1 }] });
      live.play(long, () => 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(files.load).toHaveBeenCalledTimes(1);
      expect(files.load).toHaveBeenLastCalledWith('mic', 0, WINDOW_MS + 20);
      expect(started[0]!.duration).toBeCloseTo(19.95);
      // The next window is read ahead of its turn, scheduled to start where the first one stops.
      await vi.advanceTimersByTimeAsync(WINDOW_MS);
      expect(files.load).toHaveBeenCalledTimes(2);
      expect(started[1]!.at).toBeCloseTo(started[0]!.at + started[0]!.duration);
      live.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(files.load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps one noise-removal node across plays and destroys it with the engine', async () => {
    const { ctx } = fakeContext();
    const node = rnnoise();
    const denoise = vi.fn(async () => node as unknown as AudioNode);
    const live = liveMix({ context: () => ctx, loader: loader(), denoise });
    live.play(plan({ denoise: true }), () => 0);
    await settle();
    live.play(plan({ denoise: true }), () => 1000);
    await settle();
    live.stop();
    expect(denoise).toHaveBeenCalledTimes(1);
    expect(node.disconnect).toHaveBeenCalled();
    live.dispose();
    await settle();
    expect(node.destroy).toHaveBeenCalledTimes(1);
  });

  it('a stop before the sound is ready plays nothing and does not wake the context', async () => {
    const { ctx, started, calls } = fakeContext();
    const live = liveMix({ context: () => ctx, loader: loader(), denoise: vi.fn() });
    live.play(plan(), () => 0);
    live.stop();
    await settle();
    expect(started).toEqual([]);
    expect(calls).not.toContain('resume');
    live.play(plan(), () => 0);
    await settle();
    expect(started).toHaveLength(1);
  });

  it('measures each source once, however often the cut changes', async () => {
    const files = loader();
    const live = liveMix({ context: () => fakeContext().ctx, loader: files, denoise: vi.fn() });
    const a = await live.measure(plan());
    const reads = vi.mocked(files.load).mock.calls.length;
    const b = await live.measure(plan({ length: 2500, parts: [{ track: 'voice', source: 'mic', when: 0, from: 0, length: 2500, rate: 1, gain: 1 }] }));
    expect(vi.mocked(files.load).mock.calls.length).toBe(reads);
    // A steady tone measures the same over a shorter cut of it: about -20 dBFS, in both channels, plus K-weighting.
    expect(a).not.toBeNull();
    expect(a!).toBeGreaterThan(-22);
    expect(a!).toBeLessThan(-17);
    expect(b!).toBeCloseTo(a!, 1);
    expect(await live.measure(plan(), () => true)).toBeNull();
  });
});

describe('loudness from source powers', () => {
  const steady = (power: number, hops = 100) => new Float64Array(hops).fill(power);

  it('adds the parts under their gains, and is null for silence', () => {
    const one = estimateLoudness(plan(), new Map([['mic', steady(0.01)]]))!;
    const half = estimateLoudness(plan({ parts: [{ ...plan().parts[0]!, gain: 0.5 }] }), new Map([['mic', steady(0.01)]]))!;
    expect(one - half).toBeCloseTo(20 * Math.log10(2), 1);
    expect(estimateLoudness(plan(), new Map([['mic', steady(0)]]))).toBeNull();
  });

  it('follows the music fade', () => {
    const music = plan({ parts: [{ track: 'music', source: 'song', when: 0, from: 0, length: 5000, rate: 1, gain: 1, loop: true }],
      music: { fade: [{ t: 0, gain: 0.5 }, { t: 5000, gain: 0.5 }], duck: [] } });
    const full = estimateLoudness({ ...music, music: null }, new Map([['song', steady(0.01, 10)]]))!;
    expect(full - estimateLoudness(music, new Map([['song', steady(0.01, 10)]]))!).toBeCloseTo(20 * Math.log10(2), 1);
  });
});
