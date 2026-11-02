import { describe, expect, it, vi } from 'vitest';
import type { RangeLoader } from './export';
import { liveMix } from './live';
import type { MixPlan } from './mix';

// A Web Audio stand-in that records which sources start, when and where.
function fakeContext() {
  const started: { at: number; offset: number }[] = [];
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  const param = () => ({ value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} });
  const ctx = {
    currentTime: 0, state: 'running', destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createWaveShaper: () => ({ ...node(), curve: null, oversample: 'none' }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, playbackRate: { value: 1 }, start: (at: number, offset: number) => started.push({ at, offset }), stop: () => {} }),
    resume: async () => {}, close: async () => {},
  };
  return { ctx: ctx as unknown as AudioContext, started };
}

const loader = (): RangeLoader => ({
  info: vi.fn(async () => ({ duration: 10_000, sampleRate: 48_000, channels: 1 })),
  load: vi.fn(async () => ({ duration: 10, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => new Float32Array(480) }) as unknown as AudioBuffer),
});

const plan = (patch: Partial<MixPlan> = {}): MixPlan => ({
  length: 5000, music: null, denoise: false, level: false,
  parts: [{ track: 'voice', source: 'mic', when: 0, from: 0, length: 5000, rate: 1, gain: 1 }],
  ...patch,
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('live mix', () => {
  it('plays from where the playhead is once the sound is ready, and never loads noise removal unless asked', async () => {
    const { ctx, started } = fakeContext();
    const denoise = vi.fn();
    const live = liveMix({ context: () => ctx, loader: loader(), denoise });
    live.play(plan(), () => 1000);
    await settle();
    // 50 ms ahead of the playhead, matching the 50 ms scheduling lead.
    expect(started).toEqual([{ at: 0.05, offset: 1.05 }]);
    expect(denoise).not.toHaveBeenCalled();
  });

  it('loads noise removal on the first play that needs it', async () => {
    const { ctx } = fakeContext();
    const denoise = vi.fn(async () => ({ connect: (n: unknown) => n, disconnect: () => {} }) as unknown as AudioNode);
    const live = liveMix({ context: () => ctx, loader: loader(), denoise });
    live.play(plan({ denoise: true }), () => 0);
    await settle();
    expect(denoise).toHaveBeenCalledTimes(1);
  });

  it('decodes each source once across plays, and a stop before the sound is ready plays nothing', async () => {
    const { ctx, started } = fakeContext();
    const files = loader();
    const live = liveMix({ context: () => ctx, loader: files, denoise: vi.fn() });
    live.play(plan(), () => 0);
    live.stop();
    await settle();
    expect(started).toEqual([]);
    live.play(plan(), () => 0);
    await settle();
    expect(started).toHaveLength(1);
    expect(files.load).toHaveBeenCalledTimes(1);
  });
});
