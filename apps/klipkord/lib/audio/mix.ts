// The cut's sound: what plays when (a pure plan in output ms), then Web Audio graphs for export and live preview.
import type { Word } from '../types';
import type { Cut, Placed, Project } from '../project/types';
import { cutLength, spans } from '../project/time';
import { duckEnvelope, gainAt, type Point } from './duck';
import { level as levelInPlace } from './loudness';

export type AudioTrack = 'voice' | 'tab' | 'voiceover' | 'media' | 'music';

/** One stretch of one source file played into the mix. */
export interface AudioPart {
  track: AudioTrack; source: string;
  when: number;        // output ms the part starts
  from: number;        // ms into the source file
  length: number;      // output ms it plays
  rate: number;        // playback rate (the clip's speed)
  gain: number;
  loop?: boolean;      // music repeats to fill the cut
}
export interface MixPlan {
  length: number;      // output ms
  parts: AudioPart[];
  music: { fade: Point[]; duck: Point[] } | null;
  denoise: boolean; level: boolean;
}

// cut.tracks keys whose Mute silences each audio track.
const TRACK_KEY: Record<AudioTrack, string> = { voice: 'voice', tab: 'tab', voiceover: 'voiceovers', media: 'media', music: 'music' };

/** A recording-time range played through the cut's clips: one piece per clip that keeps part of it. */
function throughClips(cut: Cut, recFrom: number, recTo: number, fileAt: (rec: number) => number) {
  const pieces: Pick<AudioPart, 'when' | 'from' | 'length' | 'rate'>[] = [];
  for (const s of spans(cut)) {
    if (s.clip.gap) continue;
    const lo = Math.max(recFrom, s.clip.in);
    const hi = Math.min(recTo, s.clip.out);
    if (hi <= lo) continue;
    pieces.push({ when: s.start + (lo - s.clip.in) / s.clip.speed, from: fileAt(lo), length: (hi - lo) / s.clip.speed, rate: s.clip.speed });
  }
  return pieces;
}

/** Removes output ranges from a part, keeping file offsets in step. */
function without(part: AudioPart, holes: [number, number][]): AudioPart[] {
  let pieces = [part];
  for (const [a, b] of holes) {
    pieces = pieces.flatMap((p) => {
      const end = p.when + p.length;
      if (b <= p.when || a >= end) return [p];
      const out: AudioPart[] = [];
      if (a > p.when) out.push({ ...p, length: a - p.when });
      if (b < end) out.push({ ...p, when: b, from: p.from + (b - p.when) * p.rate, length: end - b });
      return out;
    });
  }
  return pieces;
}

function placedParts(cut: Cut, list: Placed[], track: AudioTrack, hasAudio: (id: string) => boolean): AudioPart[] {
  return list
    .filter((p) => !p.muted && hasAudio(p.source))
    .flatMap((p) => throughClips(cut, p.at, p.at + (p.trim[1] - p.trim[0]), (rec) => p.trim[0] + rec - p.at)
      .map((piece) => ({ track, source: p.source, gain: p.volume, ...piece })));
}

function fades(length: number, fadeIn: number, fadeOut: number): Point[] {
  // On a cut shorter than both fades, each gets half.
  const scale = fadeIn + fadeOut > length ? length / (fadeIn + fadeOut) : 1;
  const fin = fadeIn * scale, fout = fadeOut * scale;
  return [...(fin > 0 ? [{ t: 0, gain: 0 }, { t: fin, gain: 1 }] : []), ...(fout > 0 ? [{ t: length - fout, gain: 1 }, { t: length, gain: 0 }] : [])];
}

/** Everything the cut plays, in output time. `words` (recording ms) drive "Lower music while you talk". */
export function mixPlan(project: Project, cut: Cut, words: Word[] = []): MixPlan {
  const length = cutLength(cut);
  const muted = (t: AudioTrack) => !!cut.tracks[TRACK_KEY[t]]?.muted;
  const audioOf = new Map(project.sources.map((s) => [s.id, s.audio]));
  const hasAudio = (id: string) => audioOf.get(id) === true;
  const { audio } = cut;
  const parts: AudioPart[] = [];

  const recorded = (track: AudioTrack, kinds: string[], gain: number) => {
    if (muted(track) || gain <= 0) return [];
    return project.sources.filter((s) => kinds.includes(s.kind) && s.audio).flatMap((s) =>
      throughClips(cut, s.offset, s.offset + s.duration, (rec) => rec - s.offset).map((piece) => ({ track, source: s.id, gain, ...piece })));
  };

  const takes = muted('voiceover') ? [] : placedParts(cut, cut.voiceovers, 'voiceover', hasAudio);
  // The original voice is silent wherever a take that mutes it plays.
  const holes = muted('voiceover') ? [] : cut.voiceovers.filter((v) => v.muteOriginal && !v.muted)
    .flatMap((v) => throughClips(cut, v.at, v.at + (v.trim[1] - v.trim[0]), (r) => r))
    .map((p): [number, number] => [p.when, p.when + p.length]);
  parts.push(...recorded('voice', ['mic', 'baked'], audio.voiceVolume).flatMap((p) => without(p, holes)));
  parts.push(...recorded('tab', ['tab'], audio.tabVolume));
  parts.push(...takes);
  if (!muted('media')) parts.push(...placedParts(cut, cut.media, 'media', hasAudio));

  let music: MixPlan['music'] = null;
  const m = audio.music;
  if (m && !muted('music') && m.volume > 0 && length > 0) {
    parts.push({ track: 'music', source: m.source, when: 0, from: 0, length, rate: 1, gain: m.volume, loop: true });
    music = { fade: fades(length, m.fadeIn, m.fadeOut), duck: m.duck ? duckEnvelope(cut, words) : [] };
  }
  return { length, parts: parts.filter((p) => p.length > 0 && p.gain > 0), music, denoise: audio.denoise, level: audio.level };
}

/** Decodes each source the plan uses once; a source that can't be loaded is left out. */
export async function loadBuffers(plan: MixPlan, load: (source: string) => Promise<AudioBuffer | null>): Promise<Map<string, AudioBuffer>> {
  const ids = [...new Set(plan.parts.map((p) => p.source))];
  const buffers = new Map<string, AudioBuffer>();
  await Promise.all(ids.map(async (id) => {
    try {
      const buffer = await load(id);
      if (buffer) buffers.set(id, buffer);
    } catch (error) {
      console.error('Klipkord: could not load audio', error);
    }
  }));
  return buffers;
}

/** Ramps an AudioParam through envelope points, with output ms `from` playing at context time `t0`. */
function applyEnvelope(param: AudioParam, points: Point[], t0: number, from: number): void {
  param.setValueAtTime(gainAt(points, from), t0);
  for (const p of points) if (p.t > from) param.linearRampToValueAtTime(p.gain, t0 + (p.t - from) / 1000);
}

export interface Graph { sources: AudioBufferSourceNode[]; nodes: AudioNode[] }

/**
 * Builds the mix graph into `out`: voice and takes through `denoise` when given, music through its fades and duck.
 * Output ms `from` plays at context time `t0`.
 */
export function connectMix(ctx: BaseAudioContext, plan: MixPlan, buffers: Map<string, AudioBuffer>, out: AudioNode,
  { t0 = ctx.currentTime, from = 0, denoise }: { t0?: number; from?: number; denoise?: AudioNode } = {}): Graph {
  const graph: Graph = { sources: [], nodes: [] };
  const gain = (value = 1) => {
    const g = ctx.createGain();
    g.gain.value = value;
    graph.nodes.push(g);
    return g;
  };
  const voiceBus = gain();
  if (denoise && plan.denoise) voiceBus.connect(denoise).connect(out);
  else voiceBus.connect(out);
  let musicBus: AudioNode | null = null;
  if (plan.music) {
    const fade = gain(), duck = gain();
    applyEnvelope(fade.gain, plan.music.fade, t0, from);
    applyEnvelope(duck.gain, plan.music.duck, t0, from);
    fade.connect(duck).connect(out);
    musicBus = fade;
  }
  const busFor = (track: AudioTrack): AudioNode =>
    track === 'voice' || track === 'voiceover' ? voiceBus : track === 'music' ? (musicBus ?? out) : out;

  for (const part of plan.parts) {
    const buffer = buffers.get(part.source);
    const end = part.when + part.length;
    if (!buffer || end <= from) continue;
    const skip = Math.max(0, from - part.when);              // output ms already played
    const at = t0 + Math.max(0, part.when - from) / 1000;
    let offset = (part.from + skip * part.rate) / 1000;
    const duration = ((part.length - skip) * part.rate) / 1000;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = part.rate;
    if (part.loop) {
      node.loop = true;
      offset %= buffer.duration;
    } else if (offset >= buffer.duration) continue;
    node.connect(gain(part.gain)).connect(busFor(part.track));
    node.start(at, offset, duration);
    graph.sources.push(node);
  }
  return graph;
}

export interface RenderOptions {
  sampleRate?: number; channels?: number;
  /** Makes the noise-removal node in the render's context (lib/audio/denoise). */
  denoise?: (ctx: BaseAudioContext) => Promise<AudioNode>;
  /** Injected for tests. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

/** Renders the whole cut's sound for export; null when the cut has no sound at all. Levels to -14 LUFS when on. */
export async function renderMix(plan: MixPlan, load: (source: string) => Promise<AudioBuffer | null>,
  { sampleRate = 48_000, channels = 2, denoise, createContext }: RenderOptions = {}): Promise<AudioBuffer | null> {
  const buffers = await loadBuffers(plan, load);
  if (!plan.length || !plan.parts.some((p) => buffers.has(p.source))) return null;
  const frames = Math.ceil((plan.length / 1000) * sampleRate);
  const ctx = createContext ? createContext(channels, frames, sampleRate) : new OfflineAudioContext(channels, frames, sampleRate);
  let clean: AudioNode | undefined;
  if (plan.denoise && denoise) {
    try {
      clean = await denoise(ctx);
    } catch (error) {
      console.error('Klipkord: could not load noise removal', error);
    }
  }
  connectMix(ctx, plan, buffers, ctx.destination, { t0: 0, from: 0, denoise: clean });
  const rendered = await ctx.startRendering();
  if (plan.level) {
    const data = Array.from({ length: rendered.numberOfChannels }, (_, i) => rendered.getChannelData(i));
    levelInPlace(data, rendered.sampleRate);
  }
  return rendered;
}

export interface Preview { stop(): void }

/**
 * Plays the mix live from output ms `from`, in step with the preview's playhead. `gain` is the level gain measured
 * ahead (loudness.gainTo); with "Even out the loudness" on, a compressor stands in for the export's limiter.
 * Create the AudioContext at 48 kHz when noise removal is used.
 */
export function startPreview(ctx: AudioContext, plan: MixPlan, buffers: Map<string, AudioBuffer>, from: number,
  { gain = 1, denoise }: { gain?: number; denoise?: AudioNode } = {}): Preview {
  const master = ctx.createGain();
  master.gain.value = plan.level ? gain : 1;
  const tail: AudioNode[] = [master];
  if (plan.level) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.08;
    master.connect(limiter).connect(ctx.destination);
    tail.push(limiter);
  } else master.connect(ctx.destination);
  const graph = connectMix(ctx, plan, buffers, master, { t0: ctx.currentTime + 0.05, from, denoise });
  return {
    stop() {
      for (const s of graph.sources) {
        try {
          s.stop();
        } catch {
          // Already ended.
        }
      }
      for (const n of [...graph.nodes, ...tail]) n.disconnect();
      denoise?.disconnect();
    },
  };
}
