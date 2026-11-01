import { describe, expect, it, vi } from 'vitest';
import { blankCut } from '../project/cuts';
import type { Clip, Cut, Placed, Project, Source } from '../project/types';
import { connectMix, mixPlan, renderMix, type MixPlan } from './mix';

const src = (id: string, kind: Source['kind'], offset: number, duration: number, audio = true): Source =>
  ({ id, kind, file: `${id}.webm`, mime: 'audio/webm', offset, duration, video: false, audio });
const clip = (id: string, inMs: number, out: number, speed = 1, gap = false): Clip => ({ id, in: inMs, out, speed, ...(gap ? { gap } : {}) });
const placed = (id: string, at: number, trim: [number, number], extra: Partial<Placed> = {}): Placed =>
  ({ id, source: id, at, trim, volume: 0.8, muted: false, ...extra });

const sources = [src('screen', 'screen', 0, 10_000, false), src('mic', 'mic', 0, 10_000), src('tab', 'tab', 500, 9500),
  src('vo', 'voiceover', 0, 3000), src('clip', 'media', 0, 2000), src('song', 'music', 0, 60_000)];
const project = (cut: Cut): Project => ({ sources, cuts: [cut] } as unknown as Project);
const cut = (clips: Clip[], patch: Partial<Cut> = {}): Cut => ({ ...blankCut({ name: 'Full', clips, made: 'full' }), ...patch });
const pick = (plan: MixPlan, track: string) => plan.parts.filter((p) => p.track === track).map(({ when, from, length, rate }) => ({ when, from, length, rate }));

describe('mix plan', () => {
  it('plays recorded sound through the clips, at each clip speed, skipping gaps', () => {
    const c = cut([clip('a', 0, 2000), clip('g', 0, 1000, 1, true), clip('b', 4000, 8000, 2)]);
    const plan = mixPlan(project(c), c);
    expect(plan.length).toBe(5000);
    expect(pick(plan, 'voice')).toEqual([{ when: 0, from: 0, length: 2000, rate: 1 }, { when: 3000, from: 4000, length: 2000, rate: 2 }]);
    // Tab audio starts 500 ms into the recording, so its file offsets are 500 ms behind.
    expect(pick(plan, 'tab')).toEqual([{ when: 500, from: 0, length: 1500, rate: 1 }, { when: 3000, from: 3500, length: 2000, rate: 2 }]);
    expect(plan.parts.find((p) => p.track === 'voice')?.gain).toBe(1);
  });

  it('anchors takes and media to recording time and drops what is cut away', () => {
    const c = cut([clip('a', 0, 2000), clip('b', 4000, 8000, 2)], {
      voiceovers: [placed('vo', 1000, [0, 3000])], media: [placed('clip', 2500, [200, 1200]), placed('clip', 5000, [0, 1000], { id: 'm2' })],
    });
    const plan = mixPlan(project(c), c);
    // The take spans rec 1000..4000: rec 1000..2000 plays, 2000..4000 is cut, rec 4000 starts the 2x clip at take ms 3000.
    expect(pick(plan, 'voiceover')).toEqual([{ when: 1000, from: 0, length: 1000, rate: 1 }]);
    expect(pick(plan, 'media')).toEqual([{ when: 2500, from: 0, length: 500, rate: 2 }]);
  });

  it('silences the original voice under a take that mutes it, and honours muted takes and tracks', () => {
    const c = cut([clip('a', 0, 10_000)], { voiceovers: [placed('vo', 2000, [0, 3000], { muteOriginal: true })] });
    expect(pick(mixPlan(project(c), c), 'voice')).toEqual([{ when: 0, from: 0, length: 2000, rate: 1 }, { when: 5000, from: 5000, length: 5000, rate: 1 }]);
    const mutedTake = { ...c, voiceovers: [{ ...c.voiceovers[0]!, muted: true }] };
    expect(pick(mixPlan(project(mutedTake), mutedTake), 'voice')).toHaveLength(1);
    expect(pick(mixPlan(project(mutedTake), mutedTake), 'voiceover')).toEqual([]);
    const mutedVoice = { ...c, tracks: { voice: { muted: true } } };
    expect(pick(mixPlan(project(mutedVoice), mutedVoice), 'voice')).toEqual([]);
  });

  it('uses the mix volumes', () => {
    const c = cut([clip('a', 0, 4000)], { audio: { denoise: true, level: true, tabVolume: 0.3, voiceVolume: 0.9 } });
    const plan = mixPlan(project(c), c);
    expect(plan.parts.find((p) => p.track === 'tab')?.gain).toBe(0.3);
    expect(plan.parts.find((p) => p.track === 'voice')?.gain).toBe(0.9);
    expect(plan).toMatchObject({ denoise: true, level: true, music: null });
    const silentTab = { ...c, audio: { ...c.audio, tabVolume: 0 } };
    expect(pick(mixPlan(project(silentTab), silentTab), 'tab')).toEqual([]);
  });

  it('loops music over the whole cut in output time with fades and ducking', () => {
    const c = cut([clip('a', 0, 4000), clip('b', 6000, 10_000, 2)], {
      audio: { denoise: false, level: false, tabVolume: 1, voiceVolume: 1, music: { source: 'song', volume: 0.3, duck: true, fadeIn: 1000, fadeOut: 2000 } },
    });
    const plan = mixPlan(project(c), c, [{ start: 1000, end: 1500, text: 'hi' }]);
    expect(plan.parts.find((p) => p.track === 'music')).toEqual({ track: 'music', source: 'song', when: 0, from: 0, length: 6000, rate: 1, gain: 0.3, loop: true });
    expect(plan.music?.fade).toEqual([{ t: 0, gain: 0 }, { t: 1000, gain: 1 }, { t: 4000, gain: 1 }, { t: 6000, gain: 0 }]);
    expect(plan.music?.duck.length).toBe(4);
    const noDuck = { ...c, audio: { ...c.audio, music: { ...c.audio.music!, duck: false } } };
    expect(mixPlan(project(noDuck), noDuck, [{ start: 1000, end: 1500, text: 'hi' }]).music?.duck).toEqual([]);
    const muted = { ...c, tracks: { music: { muted: true } } };
    expect(mixPlan(project(muted), muted).music).toBeNull();
  });
});

// A minimal Web Audio stand-in that records what gets scheduled.
function fakeContext() {
  const started: { at: number; offset: number; duration: number; rate: number; loop: boolean }[] = [];
  const ramps: [string, number, number][] = [];
  const param = () => ({ value: 1, setValueAtTime: (v: number, t: number) => ramps.push(['set', v, t]), linearRampToValueAtTime: (v: number, t: number) => ramps.push(['ramp', v, t]) });
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  const ctx = {
    currentTime: 0,
    createGain: () => ({ ...node(), gain: param() }),
    createBufferSource: () => {
      const s = { ...node(), buffer: null, loop: false, playbackRate: { value: 1 },
        start: (at: number, offset: number, duration: number) => started.push({ at, offset, duration, rate: s.playbackRate.value, loop: s.loop }) };
      return s;
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, started, ramps };
}
const buffer = (seconds: number) => ({ duration: seconds }) as AudioBuffer;

describe('mix graph', () => {
  const c = cut([clip('a', 0, 2000), clip('b', 4000, 8000, 2)], {
    audio: { denoise: false, level: false, tabVolume: 1, voiceVolume: 1, music: { source: 'song', volume: 0.5, duck: false, fadeIn: 0, fadeOut: 1000 } },
  });
  const plan = mixPlan({ ...project(c), sources: [sources[1]!, sources[5]!] }, c);

  it('starts each part at its output time, offset into the file, at its rate', () => {
    const { ctx, started } = fakeContext();
    connectMix(ctx, plan, new Map([['mic', buffer(10)], ['song', buffer(60)]]), {} as AudioNode, { t0: 0 });
    expect(started).toEqual([
      { at: 0, offset: 0, duration: 2, rate: 1, loop: false },
      { at: 2, offset: 4, duration: 4, rate: 2, loop: false },
      { at: 0, offset: 0, duration: 4, rate: 1, loop: true },
    ]);
  });

  it('starts mid-way for preview: skips what has played and sets the fade where it is', () => {
    const { ctx, started, ramps } = fakeContext();
    connectMix(ctx, plan, new Map([['mic', buffer(10)], ['song', buffer(1.5)]]), {} as AudioNode, { t0: 10, from: 3000 });
    expect(started).toEqual([
      { at: 10, offset: 6, duration: 2, rate: 2, loop: false },
      { at: 10, offset: 0, duration: 1, rate: 1, loop: true },   // 3 s into a looping 1.5 s track
    ]);
    expect(ramps).toContainEqual(['set', 1, 10]);
    expect(ramps).toContainEqual(['ramp', 0, 11]);
  });

  it('renders offline and levels the result when asked', async () => {
    const data = Float32Array.from({ length: 48_000 * 4 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 997 * i) / 48_000));
    const rendered = { numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => data } as unknown as AudioBuffer;
    const fake = fakeContext();
    const ctx = Object.assign(fake.ctx, { destination: {}, startRendering: async () => rendered }) as unknown as OfflineAudioContext;
    const createContext = vi.fn(() => ctx);
    const denoise = vi.fn(async () => ({ connect: (n: unknown) => n }) as unknown as AudioNode);
    const out = await renderMix({ ...plan, level: true, denoise: true }, async (id) => (id === 'mic' ? buffer(10) : null), { createContext, denoise });
    expect(out).toBe(rendered);
    expect(createContext).toHaveBeenCalledWith(2, 48_000 * 4, 48_000);
    expect(denoise).toHaveBeenCalledOnce();
    expect(data.reduce((m, v) => Math.max(m, v), 0)).toBeGreaterThan(0.2);
    expect(await renderMix(plan, async () => null, { createContext })).toBeNull();
  });
});
