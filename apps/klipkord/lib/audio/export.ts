// The export's sound, rendered in ~20 s chunks (each its own OfflineAudioContext with a discarded pre-roll) from only
// the source ranges each chunk plays, so a long cut never holds more than a chunk or two in memory.
import { gainTo, integratedLoudness, Limiter, LoudnessMeter } from './loudness';
import { needsDenoise, schedule, type AudioPart, type MixPlan, type Playback } from './mix';
import { Stretcher } from './stretch';

export interface SourceInfo { duration: number; sampleRate: number; channels: number }   // ms, Hz
export interface RangeLoader {
  info(source: string): Promise<SourceInfo | null>;
  /** Decodes [fromMs, toMs) of the source's sound; sample 0 is fromMs rounded to the source's sample grid. */
  load(source: string, fromMs: number, toMs: number): Promise<AudioBuffer | null>;
}

/** Planar samples for the encoder; `timestamp` is in seconds from the start of the cut. */
export interface MixChunk { timestamp: number; sampleRate: number; data: Float32Array[] }

export interface ExportOptions {
  sampleRate?: number; channels?: number;
  windowMs?: number;
  /** Rendered before each chunk and thrown away, so noise removal and resampling start warm. */
  prerollMs?: number;
  /** Makes the noise-removal node in a chunk's context (lib/audio/denoise). */
  denoise?: (ctx: BaseAudioContext) => Promise<AudioNode>;
  /** Injected for tests. */
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}
type Settings = Required<Omit<ExportOptions, 'denoise'>> & Pick<ExportOptions, 'denoise'>;

// File ms read either side of what a chunk plays, for the resampler's neighbours.
const MARGIN_MS = 20;
// Parts of one source in one chunk are read in one go when they lie this close together.
const JOIN_MS = 60_000;

/** Turns looping parts into back-to-back plain ones over the source's length; only the outer ends fade. */
export function unloop(parts: AudioPart[], infos: Map<string, SourceInfo>): AudioPart[] {
  return parts.flatMap((part) => {
    const duration = infos.get(part.source)?.duration ?? 0;
    if (!part.loop || duration <= 0) return [part];
    const pieces: AudioPart[] = [];
    let t = 0, file = part.from % duration;
    while (part.length - t > 1e-6) {
      const length = Math.min(part.length - t, (duration - file) / part.rate);
      pieces.push({ ...part, loop: undefined, when: part.when + t, from: file, length,
        seams: { start: t > 0, end: t + length < part.length - 1e-6 } });
      t += length;
      file = 0;
    }
    return pieces;
  });
}

/** A natural-voice part stretched as the export moves through it, keeping only the output not yet passed. */
class StretchStream {
  private readonly s: Stretcher;
  private readonly base: number;      // source sample the part starts at
  private readonly input: number;     // source samples the part reads
  private out: Float32Array<ArrayBuffer>[];
  private outStart = 0;

  constructor(private readonly part: AudioPart, private readonly info: SourceInfo, private readonly loader: RangeLoader) {
    const sr = info.sampleRate;
    this.s = new Stretcher(part.rate, sr, info.channels);
    this.base = Math.round((part.from * sr) / 1000);
    this.input = Math.round((part.length * part.rate * sr) / 1000);
    this.out = Array.from({ length: info.channels }, () => new Float32Array(0));
  }

  /** Stretched samples [from, to) of the part, at the source's rate. Calls must not move backwards. */
  async read(from: number, to: number): Promise<Float32Array<ArrayBuffer>[] | null> {
    const { s, info } = this;
    const sr = info.sampleRate;
    while (s.made < to) {
      const blocks = Math.ceil((to - s.made) / s.hop);
      const [lo, hi] = s.needs(blocks);
      const a = Math.max(0, lo), b = Math.min(this.input, hi);
      let data: Float32Array[] = [];
      if (b > a) {
        const buffer = await this.loader.load(this.part.source, ((this.base + a) * 1000) / sr, ((this.base + b) * 1000) / sr);
        if (!buffer) return null;
        data = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
      }
      const made = s.next({ start: a, data }, blocks);
      this.out = this.out.map((o, c) => {
        const joined = new Float32Array(o.length + made[c]!.length);
        joined.set(o);
        joined.set(made[c]!, o.length);
        return joined;
      });
    }
    const slice = this.out.map((o) => o.slice(from - this.outStart, to - this.outStart));
    this.out = this.out.map((o) => o.slice(from - this.outStart));
    this.outStart = from;
    return slice;
  }
}

/** Raw mix chunks, back to back from the start of the cut. */
async function* renderChunks(plan: MixPlan, parts: AudioPart[], infos: Map<string, SourceInfo>, loader: RangeLoader, levels: Map<string, number>,
  o: Settings): AsyncGenerator<Float32Array[]> {
  const sr = o.sampleRate;
  const total = Math.ceil((plan.length / 1000) * sr);
  const win = Math.max(1, Math.round((o.windowMs * sr) / 1000)), pre = Math.round((o.prerollMs * sr) / 1000);
  const streams = new Map<AudioPart, StretchStream>();
  const chunkPlan = { ...plan, parts };
  let denoiseFailed = false;
  for (let s0 = 0; s0 < total; s0 += win) {
    const s1 = Math.min(total, s0 + win), r = Math.max(0, s0 - pre);
    const from = (r * 1000) / sr, to = (s1 * 1000) / sr;
    const ctx = o.createContext(o.channels, s1 - r, sr);
    const play = new Map<AudioPart, Playback>();
    const plain: { part: AudioPart; lo: number; hi: number }[] = [];   // source samples each plain part reads
    for (const part of parts) {
      const a = Math.max(part.when, from), b = Math.min(part.when + part.length, to);
      if (b <= a) continue;
      const info = infos.get(part.source)!, rate = info.sampleRate;
      if (part.natural) {
        let stream = streams.get(part);
        if (!stream) streams.set(part, (stream = new StretchStream(part, info, loader)));
        const outLen = Math.round(Math.round((part.length * part.rate * rate) / 1000) / part.rate);
        const lo = Math.max(0, Math.floor(((a - part.when) * rate) / 1000));
        const hi = Math.min(outLen, Math.ceil(((b - part.when) * rate) / 1000) + 1);
        const data = hi > lo ? await stream.read(lo, hi) : null;
        if (!data) continue;
        play.set(part, { buffer: toBuffer(ctx, data, rate), origin: (-lo * 1000) / rate, rate: 1 });
      } else {
        const fa = part.from + (a - part.when) * part.rate - MARGIN_MS, fb = part.from + (b - part.when) * part.rate + MARGIN_MS;
        plain.push({ part, lo: Math.max(0, Math.floor((fa * rate) / 1000)), hi: Math.ceil((fb * rate) / 1000) });
      }
    }
    // Word cuts make many short parts of one source: read each source's range once when its parts lie together.
    const bySource = new Map<string, typeof plain>();
    for (const p of plain) bySource.set(p.part.source, [...(bySource.get(p.part.source) ?? []), p]);
    for (const [source, group] of bySource) {
      const rate = infos.get(source)!.sampleRate;
      const lo = Math.min(...group.map((g) => g.lo)), hi = Math.max(...group.map((g) => g.hi));
      const reads = ((hi - lo) * 1000) / rate <= JOIN_MS ? [{ lo, hi, parts: group }] : group.map((g) => ({ ...g, parts: [g] }));
      for (const read of reads) {
        const buffer = await loader.load(source, (read.lo * 1000) / rate, (read.hi * 1000) / rate);
        if (!buffer) continue;
        for (const { part } of read.parts) play.set(part, { buffer, origin: part.from - (read.lo * 1000) / rate, rate: part.rate });
      }
    }
    let clean: AudioNode | undefined;
    if (needsDenoise(plan) && o.denoise && !denoiseFailed) {
      try {
        clean = await o.denoise(ctx);
      } catch (error) {
        denoiseFailed = true;
        console.error('Klipkord: could not load noise removal', error);
      }
    }
    schedule(ctx, chunkPlan, (part) => play.get(part) ?? null, ctx.destination, { t0: 0, from, to, denoise: clean, levels });
    const rendered = await ctx.startRendering();
    yield Array.from({ length: o.channels }, (_, c) =>
      rendered.getChannelData(Math.min(c, rendered.numberOfChannels - 1)).slice(s0 - r, s1 - r));
  }
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array<ArrayBuffer>[], sampleRate: number): AudioBuffer {
  const buffer = ctx.createBuffer(data.length, Math.max(1, data[0]?.length ?? 0), sampleRate);
  data.forEach((d, c) => buffer.copyToChannel(d, c));
  return buffer;
}

/** Loudness gain of each "Clean and level" take, measured over its whole file (takes are short). */
async function takeLevels(parts: AudioPart[], infos: Map<string, SourceInfo>, loader: RangeLoader): Promise<Map<string, number>> {
  const levels = new Map<string, number>();
  for (const id of new Set(parts.filter((p) => p.clean).map((p) => p.source))) {
    try {
      const b = await loader.load(id, 0, infos.get(id)!.duration);
      if (b) levels.set(id, gainTo(integratedLoudness(Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c)), b.sampleRate)));
    } catch (error) {
      console.error('Klipkord: could not measure the voiceover', error);
    }
  }
  return levels;
}

/**
 * The cut's sound for export, as chunks for the encoder; null when the cut has no sound at all. With "Even out the
 * loudness" on it renders twice: once into a streaming meter, then again through the gain to -14 LUFS and a limiter.
 */
export async function exportMix(plan: MixPlan, loader: RangeLoader, options: ExportOptions = {}): Promise<AsyncIterable<MixChunk> | null> {
  const o: Settings = {
    sampleRate: 48_000, channels: 2, windowMs: 20_000, prerollMs: 1000,
    createContext: (channels, length, sampleRate) => new OfflineAudioContext(channels, length, sampleRate),
    ...options,
  };
  const infos = new Map<string, SourceInfo>();
  await Promise.all([...new Set(plan.parts.map((p) => p.source))].map(async (id) => {
    try {
      const info = await loader.info(id);
      if (info && info.duration > 0) infos.set(id, info);
    } catch (error) {
      console.error('Klipkord: could not load audio', error);
    }
  }));
  const parts = unloop(plan.parts.filter((p) => infos.has(p.source)), infos);
  if (!plan.length || !parts.length) return null;
  const sr = o.sampleRate;
  return {
    async *[Symbol.asyncIterator]() {
      const levels = await takeLevels(parts, infos, loader);
      let gain = 1;
      if (plan.level) {
        const meter = new LoudnessMeter(sr, o.channels);
        for await (const chunk of renderChunks(plan, parts, infos, loader, levels, o)) meter.push(chunk);
        gain = gainTo(meter.integrated());
      }
      const limiter = plan.level ? new Limiter(sr, o.channels) : null;
      let made = 0;
      const emit = (data: Float32Array[]): MixChunk => {
        const chunk = { timestamp: made / sr, sampleRate: sr, data };
        made += data[0]?.length ?? 0;
        return chunk;
      };
      for await (const chunk of renderChunks(plan, parts, infos, loader, levels, o)) {
        if (!limiter) {
          yield emit(chunk);
          continue;
        }
        if (gain !== 1) for (const ch of chunk) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
        const out = limiter.process(chunk);
        if (out[0]?.length) yield emit(out);
      }
      const rest = limiter?.flush();
      if (rest?.[0]?.length) yield emit(rest);
    },
  };
}
