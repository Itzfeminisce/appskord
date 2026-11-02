// The cut's sound: what plays when (a pure plan in output ms), then Web Audio graphs for export and live preview.
import type { Word } from '../types';
import type { Cut, Placed, Project } from '../project/types';
import { takeEnd } from '../project/media';
import { cutLength, spans } from '../project/time';
import { duckEnvelope, gainAt, type Point } from './duck';
import { CEILING, gainTo, integratedLoudness } from './loudness';
import { stretch } from './stretch';

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
  natural?: boolean;   // "Keep the voice natural": time-stretched to `rate`, played at rate 1
  seams?: { start?: boolean; end?: boolean };  // runs on from the part before / into the next: no fade there
  clean?: boolean;     // a take with "Clean and level": through noise removal and its own loudness gain
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
  const pieces: Pick<AudioPart, 'when' | 'from' | 'length' | 'rate' | 'natural'>[] = [];
  for (const s of spans(cut)) {
    if (s.clip.gap) continue;
    const lo = Math.max(recFrom, s.clip.in);
    const hi = Math.min(recTo, s.clip.out);
    if (hi <= lo) continue;
    pieces.push({ when: s.start + (lo - s.clip.in) / s.clip.speed, from: fileAt(lo), length: (hi - lo) / s.clip.speed, rate: s.clip.speed,
      ...(s.clip.naturalVoice && s.clip.speed !== 1 && { natural: true }) });
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

/** Takes are said in output time: each plays at rate 1 from where it was recorded, whatever the clip's speed. */
function takeParts(cut: Cut, list: Placed[], hasAudio: (id: string) => boolean): AudioPart[] {
  return list.filter((p) => !p.muted && hasAudio(p.source)).flatMap((p) => {
    const end = takeEnd(cut, p), k = (end - p.at) / Math.max(1, p.trim[1] - p.trim[0]);
    return throughClips(cut, p.at, end, (rec) => p.trim[0] + (rec - p.at) / k).map(({ when, from, length }): AudioPart =>
      ({ track: 'voiceover', source: p.source, gain: p.volume, when, from, length, rate: 1, ...(p.clean && { clean: true }) }));
  });
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

  const takes = muted('voiceover') ? [] : takeParts(cut, cut.voiceovers, hasAudio);
  // The original voice is silent wherever a take that mutes it plays.
  const replaced = muted('voiceover') ? [] : cut.voiceovers.filter((v) => v.muteOriginal && !v.muted);
  const holes = replaced.flatMap((v) => throughClips(cut, v.at, takeEnd(cut, v), (r) => r))
    .map((p): [number, number] => [p.when, p.when + p.length]);
  parts.push(...recorded('voice', ['mic', 'baked'], audio.voiceVolume).flatMap((p) => without(p, holes)));
  parts.push(...recorded('tab', ['tab'], audio.tabVolume));
  parts.push(...takes);
  if (!muted('media')) parts.push(...placedParts(cut, cut.media, 'media', hasAudio));

  let music: MixPlan['music'] = null;
  const m = audio.music;
  if (m && !muted('music') && m.volume > 0 && length > 0) {
    parts.push({ track: 'music', source: m.source, when: 0, from: 0, length, rate: 1, gain: m.volume, loop: true });
    // Only words still heard duck the music: none when the voice is off, none under a take that replaces it.
    const heard = muted('voice') || audio.voiceVolume <= 0 ? [] : words.filter((w) => {
      const mid = (w.start + w.end) / 2;
      return !replaced.some((v) => mid >= v.at && mid < takeEnd(cut, v));
    });
    music = { fade: fades(length, m.fadeIn, m.fadeOut), duck: m.duck ? duckEnvelope(cut, heard) : [] };
  }
  return { length, parts: parts.filter((p) => p.length > 0 && p.gain > 0), music, denoise: audio.denoise, level: audio.level };
}

/** True when the plan needs the noise-removal node: for the voice, or for a take with "Clean and level". */
export const needsDenoise = (plan: MixPlan): boolean => plan.denoise || plan.parts.some((p) => p.clean);

/** The gain that brings each "Clean and level" take's source to the target loudness, from its decoded sound. */
export function takeLevels(plan: MixPlan, buffers: Map<string, AudioBuffer>): Map<string, number> {
  const levels = new Map<string, number>();
  for (const id of new Set(plan.parts.filter((p) => p.clean).map((p) => p.source))) {
    const b = buffers.get(id);
    if (b) levels.set(id, gainTo(integratedLoudness(Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)), b.sampleRate)));
  }
  return levels;
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

/** Fade at each edge of a part, so cuts between words don't click. */
export const EDGE_MS = 5;

/** A part's gain over output time: up from silence and back down over EDGE_MS, except at seams. */
export function partEnvelope(part: AudioPart): Point[] {
  const edge = Math.min(EDGE_MS, part.length / 2), end = part.when + part.length;
  return [
    ...(part.seams?.start ? [{ t: part.when, gain: part.gain }] : [{ t: part.when, gain: 0 }, { t: part.when + edge, gain: part.gain }]),
    ...(part.seams?.end ? [{ t: end, gain: part.gain }] : [{ t: end - edge, gain: part.gain }, { t: end, gain: 0 }]),
  ];
}

/** What a part plays: output ms t into the part reads `buffer` at ms `origin + t * rate`. */
export interface Playback { buffer: AudioBuffer; origin: number; rate: number }

export interface Graph { sources: AudioBufferSourceNode[]; nodes: AudioNode[] }

/** Stretched parts, by source, file range and speed; reused across preview restarts. */
export type StretchCache = Map<string, AudioBuffer>;

export const stretchKey = (p: AudioPart) => `${p.source}|${p.from}|${p.length * p.rate}|${p.rate}`;

/** Time-stretches each "Keep the voice natural" part not yet in `cache`, from the whole decoded sources. */
export function stretchParts(ctx: BaseAudioContext, plan: MixPlan, buffers: Map<string, AudioBuffer>, cache: StretchCache = new Map()): StretchCache {
  for (const part of plan.parts) {
    const buffer = buffers.get(part.source);
    const key = stretchKey(part);
    if (!part.natural || !buffer || cache.has(key)) continue;
    const sr = buffer.sampleRate;
    const first = Math.round((part.from * sr) / 1000), n = Math.round((part.length * part.rate * sr) / 1000);
    const input = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice(first, first + n));
    const out = stretch(input, part.rate, sr);
    const made = ctx.createBuffer(out.length, Math.max(1, out[0]!.length), sr);
    out.forEach((d, c) => made.copyToChannel(d, c));
    cache.set(key, made);
  }
  return cache;
}

export interface ScheduleOptions {
  t0?: number; from?: number;
  /** Output ms past which nothing new is started (a chunk's end). */
  to?: number;
  denoise?: AudioNode;
  /** Loudness gain of each "Clean and level" take's source (takeLevels). */
  levels?: ReadonlyMap<string, number>;
}

/** Builds the mix graph into `out` from parts resolved by `play`; output ms `from` plays at context time `t0`. */
export function schedule(ctx: BaseAudioContext, plan: MixPlan, play: (part: AudioPart) => Playback | null, out: AudioNode,
  { t0 = ctx.currentTime, from = 0, to = Infinity, denoise, levels }: ScheduleOptions = {}): Graph {
  const graph: Graph = { sources: [], nodes: [] };
  const gain = (value = 1) => {
    const g = ctx.createGain();
    g.gain.value = value;
    graph.nodes.push(g);
    return g;
  };
  const voiceBus = gain();
  // Clean takes go through noise removal on their own bus, so the rest of the voice stays as set.
  const cleanBus = plan.parts.some((p) => p.clean) ? gain() : null;
  if (denoise && (plan.denoise || cleanBus)) denoise.connect(out);
  voiceBus.connect(denoise && plan.denoise ? denoise : out);
  cleanBus?.connect(denoise ?? out);
  let musicBus: AudioNode | null = null;
  if (plan.music) {
    const fade = gain(), duck = gain();
    applyEnvelope(fade.gain, plan.music.fade, t0, from);
    applyEnvelope(duck.gain, plan.music.duck, t0, from);
    fade.connect(duck).connect(out);
    musicBus = fade;
  }
  const busFor = ({ track, clean }: AudioPart): AudioNode =>
    clean && cleanBus ? cleanBus : track === 'voice' || track === 'voiceover' ? voiceBus : track === 'music' ? (musicBus ?? out) : out;

  for (const part of plan.parts) {
    const end = part.when + part.length;
    if (end <= from || part.when >= to) continue;
    const p = play(part);
    if (!p) continue;
    const skip = Math.max(0, from - part.when);              // output ms already played
    const at = t0 + Math.max(0, part.when - from) / 1000;
    let offset = (p.origin + skip * p.rate) / 1000;
    const duration = ((part.length - skip) * p.rate) / 1000;
    const node = ctx.createBufferSource();
    node.buffer = p.buffer;
    node.playbackRate.value = p.rate;
    if (part.loop) {
      node.loop = true;
      offset %= p.buffer.duration;
    } else if (offset >= p.buffer.duration) continue;
    const level = gain(0), lift = part.clean ? (levels?.get(part.source) ?? 1) : 1;
    applyEnvelope(level.gain, partEnvelope(lift === 1 ? part : { ...part, gain: part.gain * lift }), t0, from);
    node.connect(level).connect(busFor(part));
    node.start(at, offset, duration);
    graph.sources.push(node);
  }
  return graph;
}

/**
 * Builds the mix graph into `out` from whole decoded sources: voice and takes through `denoise` when given, music
 * through its fades and duck, natural-voice parts from `stretched` when there. Output ms `from` plays at `t0`.
 */
export function connectMix(ctx: BaseAudioContext, plan: MixPlan, buffers: Map<string, AudioBuffer>, out: AudioNode,
  { stretched, levels = takeLevels(plan, buffers), ...options }: Omit<ScheduleOptions, 'to'> & { stretched?: StretchCache } = {}): Graph {
  return schedule(ctx, plan, (part) => {
    const done = part.natural ? stretched?.get(stretchKey(part)) : undefined;
    if (done) return { buffer: done, origin: 0, rate: 1 };
    const buffer = buffers.get(part.source);
    return buffer ? { buffer, origin: part.from, rate: part.rate } : null;
  }, out, { ...options, levels });
}

/** A soft-clip curve over input -range..range: straight up to 80% of the ceiling, then easing into it. */
export function softClipCurve(range: number, ceiling = CEILING, points = 4096): Float32Array<ArrayBuffer> {
  const knee = 0.8 * ceiling, room = ceiling - knee;
  return Float32Array.from({ length: points }, (_, i) => {
    const x = (i / (points - 1)) * 2 * range - range, a = Math.abs(x);
    return Math.sign(x) * (a <= knee ? a : knee + room * Math.tanh((a - knee) / room));
  });
}

// A WaveShaper reads input in -1..1, so the master gain scales the mix down by this and the curve scales it back.
const SHAPER_RANGE = 16;

export interface Preview { stop(): void }

/**
 * Plays the mix live from output ms `from`, in step with the preview's playhead. `gain` is the level gain measured
 * ahead (loudness.gainTo); with "Even out the loudness" on, a soft clipper holds peaks under the export's ceiling
 * (no compressor, so no make-up gain). Natural-voice parts are stretched into `stretched` on first play.
 * Create the AudioContext at 48 kHz when noise removal is used.
 */
export function startPreview(ctx: AudioContext, plan: MixPlan, buffers: Map<string, AudioBuffer>, from: number,
  { gain = 1, denoise, stretched = new Map() }: { gain?: number; denoise?: AudioNode; stretched?: StretchCache } = {}): Preview {
  const master = ctx.createGain();
  const tail: AudioNode[] = [master];
  if (plan.level) {
    master.gain.value = gain / SHAPER_RANGE;
    const clipper = ctx.createWaveShaper();
    clipper.curve = softClipCurve(SHAPER_RANGE);
    clipper.oversample = '2x';
    master.connect(clipper).connect(ctx.destination);
    tail.push(clipper);
  } else master.connect(ctx.destination);
  stretchParts(ctx, plan, buffers, stretched);
  const graph = connectMix(ctx, plan, buffers, master, { t0: ctx.currentTime + 0.05, from, denoise, stretched });
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
