import { describe, expect, it } from 'vitest';
import { blankCut } from '../project/cuts';
import type { Clip, Cut, Placed, Project, Source } from '../project/types';
import { CEILING } from './loudness';
import { connectMix, EDGE_MS, mixPlan, partEnvelope, softClipCurve, stretchKey, type AudioPart, type MixPlan } from './mix';

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

  it('ducks only under words still heard: not where a take replaces the voice, not when the voice is off', () => {
    const music = { source: 'song', volume: 0.3, duck: true, fadeIn: 0, fadeOut: 0 };
    const c = cut([clip('a', 0, 10_000)], { audio: { denoise: false, level: false, tabVolume: 1, voiceVolume: 1, music },
      voiceovers: [placed('vo', 4000, [0, 3000], { muteOriginal: true })] });
    const words = [{ start: 1000, end: 1400, text: 'hi' }, { start: 5000, end: 5400, text: 'gone' }];
    expect(mixPlan(project(c), c, words).music?.duck.map((p) => p.t)).toEqual([880, 1000, 1400, 1850]);
    const off = { ...c, tracks: { voice: { muted: true } } };
    expect(mixPlan(project(off), off, words).music?.duck).toEqual([]);
  });

  it('marks parts of natural-voice clips that change speed', () => {
    const c = cut([{ ...clip('a', 0, 2000, 2), naturalVoice: true }, { ...clip('b', 2000, 4000), naturalVoice: true }]);
    expect(mixPlan(project(c), c).parts.filter((p) => p.track === 'voice').map((p) => p.natural)).toEqual([true, undefined]);
  });

  it('fades each part in and out over 5 ms, except at seams', () => {
    const part: AudioPart = { track: 'voice', source: 'mic', when: 100, from: 0, length: 1000, rate: 1, gain: 0.5 };
    expect(partEnvelope(part)).toEqual([{ t: 100, gain: 0 }, { t: 100 + EDGE_MS, gain: 0.5 }, { t: 1100 - EDGE_MS, gain: 0.5 }, { t: 1100, gain: 0 }]);
    expect(partEnvelope({ ...part, seams: { start: true, end: true } })).toEqual([{ t: 100, gain: 0.5 }, { t: 1100, gain: 0.5 }]);
    expect(partEnvelope({ ...part, length: 4 })[1]).toEqual({ t: 102, gain: 0.5 });
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

  it('fades each part at its edges, and starts mid-fade where the preview starts', () => {
    const { ctx, ramps } = fakeContext();
    connectMix(ctx, plan, new Map([['mic', buffer(10)]]), {} as AudioNode, { t0: 0, from: 0 });
    expect(ramps).toContainEqual(['ramp', 1, EDGE_MS / 1000]);
    expect(ramps).toContainEqual(['ramp', 0, 2]);
  });

  it('plays a natural-voice part from its stretched buffer at rate 1', () => {
    const natural: MixPlan = { ...plan, music: null, parts: [{ ...plan.parts[1]!, natural: true }] };
    const { ctx, started } = fakeContext();
    const stretched = { duration: 2 } as AudioBuffer;
    connectMix(ctx, natural, new Map([['mic', buffer(10)]]), {} as AudioNode, { t0: 0, stretched: new Map([[stretchKey(natural.parts[0]!), stretched]]) });
    expect(started).toEqual([{ at: 2, offset: 0, duration: 2, rate: 1, loop: false }]);
  });
});

describe('preview clipper', () => {
  it('passes quiet audio straight and never goes past the ceiling', () => {
    const curve = softClipCurve(16);
    const at = (x: number) => curve[Math.round(((x + 16) / 32) * (curve.length - 1))]!;
    expect(at(0.5)).toBeCloseTo(0.5, 2);
    expect(Math.max(...curve)).toBeLessThanOrEqual(CEILING);
    expect(at(1)).toBeGreaterThan(at(0.85));
  });
});
