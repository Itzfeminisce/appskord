// The editor's live sound: the export's plan and graph (mix.ts), read and played in windows from the playhead, so what
// you hear is what exports and a long recording never sits decoded in memory.
import { gainAt } from './duck';
import { readPlain, takeLevels, unloop, type RangeLoader, type SourceInfo } from './export';
import { gainTo, gated, LoudnessMeter } from './loudness';
import { needsDenoise, schedule, softClipCurve, type AudioPart, type Graph, type MixPlan, type Playback } from './mix';
import { stretch } from './stretch';

export interface LiveDeps {
  /** Made on first play, at 48 kHz for noise removal; kept for the editor's life. */
  context(): AudioContext;
  loader: RangeLoader;
  /** Noise removal; only called when the plan needs it, so RNNoise loads on first use. */
  denoise(ctx: BaseAudioContext): Promise<AudioNode>;
  /** Names a source's current file, so what was measured from it is kept until the file changes. */
  fileKey?(source: string): string;
}

export interface LiveMix {
  /** Plays `plan` from the playhead `at()` reads once the sound is ready; `lufs` is the mix's measured loudness. */
  play(plan: MixPlan, at: () => number, lufs?: number | null): void;
  stop(): void;
  /** The mix's integrated loudness before "Even out the loudness", or null when it has no sound. */
  measure(plan: MixPlan, cancelled?: () => boolean): Promise<number | null>;
  dispose(): void;
}

/** Output ms read and scheduled at a time, like the export's chunks. */
export const WINDOW_MS = 20_000;
/** The next window is read once the one playing has this long left. */
export const AHEAD_MS = 8_000;
// The sound starts this long after scheduling, where the playhead will be by then.
const LEAD_MS = 50;
// Output ms stretched either side of a natural-voice window and thrown away, so the stretch starts warm.
const STRETCH_PAD_MS = 200;
// A WaveShaper reads input in -1..1, so the master gain scales the mix down by this and the curve scales it back.
const SHAPER_RANGE = 16;
const HOP_MS = 100;
// Natural-voice windows are stretched apart, so each joins the next through a linear crossfade this long (same source both sides, so gains sum to 1).
export const XFADE_MS = 8;

/** Fades `out` in over `ms` from sample `head` and out over `ms` from sample `tail` (equal power), in place. */
export function crossfadeEdges(out: Float32Array[], sr: number, head: number | null, tail: number | null, ms = XFADE_MS): void {
  const n = Math.max(1, Math.round((ms / 1000) * sr));
  for (const d of out) {
    if (head !== null) {
      for (let i = 0; i < d.length; i++) {
        if (i < head) d[i] = 0;
        else if (i < head + n) d[i]! *= (i - head + 0.5) / n;
      }
    }
    if (tail !== null) {
      for (let i = Math.max(0, tail); i < d.length; i++) d[i]! *= i < tail + n ? 1 - (i - tail + 0.5) / n : 0;
    }
  }
}

/**
 * Integrated loudness of the plan from each source's 100 ms hop powers (stereo, per sample), summing the parts'
 * powers under their gains, music fade and duck: what the export would meter, without decoding the mix again.
 */
export function estimateLoudness(plan: MixPlan, powers: ReadonlyMap<string, Float64Array>, levels?: ReadonlyMap<string, number>): number | null {
  const hops = new Float64Array(Math.ceil(plan.length / HOP_MS));
  for (const part of plan.parts) {
    const src = powers.get(part.source);
    if (!src?.length) continue;
    const end = part.when + part.length;
    for (let h = Math.floor(part.when / HOP_MS); h < Math.min(hops.length, Math.ceil(end / HOP_MS)); h++) {
      const a = Math.max(part.when, h * HOP_MS), b = Math.min(end, (h + 1) * HOP_MS);
      if (b <= a) continue;
      const t = (a + b) / 2;
      let k = Math.floor((part.from + (t - part.when) * part.rate) / HOP_MS);
      if (part.loop) k %= src.length;
      if (k < 0 || k >= src.length) continue;
      const music = part.track === 'music' && plan.music ? gainAt(plan.music.fade, t) * gainAt(plan.music.duck, t) : 1;
      const g = part.gain * music * (part.clean ? (levels?.get(part.source) ?? 1) : 1);
      hops[h]! += g * g * src[k]! * ((b - a) / HOP_MS);
    }
  }
  const blocks: number[] = [];
  for (let i = 0; i + 4 <= hops.length; i++) blocks.push((hops[i]! + hops[i + 1]! + hops[i + 2]! + hops[i + 3]!) / 4);
  const lufs = gated(blocks);
  return Number.isFinite(lufs) ? lufs : null;
}

const cancelledError = new Error('cancelled');

export function liveMix(deps: LiveDeps): LiveMix {
  const fileKey = deps.fileKey ?? ((id: string) => id);
  let ctx: AudioContext | null = null;
  let rnnoise: Promise<AudioNode | undefined> | null = null;
  const levels = new Map<string, number>();
  const measured = new Map<string, { p: Promise<Float64Array | null>; waiters: Set<() => boolean> }>();
  let run = 0;
  let playing: { graphs: { graph: Graph; end: number }[]; tail: AudioNode[]; clean?: AudioNode } | null = null;

  const release = (graph: Graph) => {
    for (const s of graph.sources) {
      try {
        s.stop();
      } catch {
        // Already ended.
      }
    }
    for (const n of graph.nodes) n.disconnect();
  };
  const stop = () => {
    run++;
    if (playing) {
      for (const { graph } of playing.graphs) release(graph);
      for (const n of playing.tail) n.disconnect();
      playing.clean?.disconnect();
    }
    playing = null;
    // A suspended context idles the audio thread and noise removal until the next play.
    if (ctx?.state === 'running') void ctx.suspend().catch(() => {});
  };

  // One noise-removal node per context, reused by every play and destroyed with the context.
  const denoiseNode = (c: AudioContext) => (rnnoise ??= deps.denoise(c).catch((error: unknown) => {
    console.error('Klipkord: could not load noise removal', error);
    rnnoise = null;
    return undefined;
  }));

  async function infosOf(ids: Iterable<string>): Promise<Map<string, SourceInfo>> {
    const infos = new Map<string, SourceInfo>();
    await Promise.all([...new Set(ids)].map(async (id) => {
      try {
        const info = await deps.loader.info(id);
        if (info && info.duration > 0) infos.set(id, info);
      } catch (error) {
        console.error('Klipkord: could not load audio', error);
      }
    }));
    return infos;
  }

  /** A natural-voice part's output ms [from, to), stretched from just its source range. */
  async function stretchWindow(c: BaseAudioContext, part: AudioPart, sr: number, from: number, to: number): Promise<Playback | null> {
    const lo = Math.max(0, from - part.when - STRETCH_PAD_MS), hi = Math.min(part.length, to - part.when + STRETCH_PAD_MS);
    const buffer = await deps.loader.load(part.source, part.from + lo * part.rate, part.from + hi * part.rate);
    if (!buffer) return null;
    const out = stretch(Array.from({ length: buffer.numberOfChannels }, (_, ch) => buffer.getChannelData(ch)), part.rate, sr);
    // Fade in at this window's start and out after its end (the tail is scheduled over the next window's start).
    const at = (ms: number) => Math.round(((ms - lo) / 1000) * sr);
    crossfadeEdges(out, sr, from > part.when ? at(from - part.when) : null, to < part.when + part.length ? at(to - part.when) : null);
    const made = c.createBuffer(out.length, Math.max(1, out[0]?.length ?? 0), sr);
    out.forEach((d, ch) => made.copyToChannel(d, ch));
    return { buffer: made, origin: -lo, rate: 1 };
  }

  async function readWindow(c: BaseAudioContext, parts: AudioPart[], infos: Map<string, SourceInfo>, from: number, to: number) {
    const play = await readPlain(parts, infos, deps.loader, from, to);
    for (const part of parts) {
      if (!part.natural || part.when >= to || part.when + part.length <= from) continue;
      const p = await stretchWindow(c, part, infos.get(part.source)!.sampleRate, from, to);
      if (p) play.set(part, p);
    }
    return play;
  }

  /** Loudness gain of each "Clean and level" take, measured once per file. */
  async function levelsOf(parts: AudioPart[], infos: Map<string, SourceInfo>): Promise<Map<string, number>> {
    const missing = parts.filter((p) => p.clean && !levels.has(fileKey(p.source)));
    if (missing.length) for (const [id, gain] of await takeLevels(missing, infos, deps.loader)) levels.set(fileKey(id), gain);
    return new Map(parts.filter((p) => p.clean && levels.has(fileKey(p.source))).map((p) => [p.source, levels.get(fileKey(p.source))!]));
  }

  /** A source's hop powers, read once per file in windows; stops when every caller waiting on it has gone. */
  async function powersOf(id: string, cancelled: () => boolean): Promise<Float64Array | null> {
    const key = fileKey(id);
    let job = measured.get(key);
    if (!job) {
      const waiters = new Set<() => boolean>();
      const p = (async () => {
        const info = await deps.loader.info(id);
        if (!info || info.duration <= 0) return null;
        const meter = new LoudnessMeter(info.sampleRate, info.channels);
        for (let a = 0; a < info.duration; a += WINDOW_MS) {
          if ([...waiters].every((w) => w())) throw cancelledError;
          const b = await deps.loader.load(id, a, Math.min(info.duration, a + WINDOW_MS));
          if (!b) return null;
          meter.push(Array.from({ length: b.numberOfChannels }, (_, ch) => b.getChannelData(ch)));
        }
        // A mono source plays in both channels of the stereo mix.
        const powers = meter.hopPowers();
        return info.channels === 1 ? powers.map((v) => v * 2) : powers;
      })();
      job = { p, waiters };
      measured.set(key, job);
      p.catch(() => measured.delete(key));
    }
    job.waiters.add(cancelled);
    try {
      return await job.p;
    } finally {
      job.waiters.delete(cancelled);
    }
  }

  return {
    play(plan, at, lufs) {
      stop();
      const mine = run;
      const current = () => mine === run;
      const c = (ctx ??= deps.context());
      void (async () => {
        const infos = await infosOf(plan.parts.map((p) => p.source));
        const parts = unloop(plan.parts.filter((p) => infos.has(p.source)), infos);
        if (!current() || !parts.length || !plan.length) return;
        const full = { ...plan, parts };
        const clean = needsDenoise(plan) ? await denoiseNode(c) : undefined;
        const gains = await levelsOf(parts, infos);
        let next = Math.min(plan.length, at());
        let t: number | null = null;   // context time `next` plays at, once the sound has started
        let state: NonNullable<typeof playing> | null = null;
        for (;;) {
          const to = Math.min(plan.length, next + WINDOW_MS);
          const read = await readWindow(c, parts, infos, next, to);
          if (!current()) return;
          if (t !== null && t < c.currentTime) {
            // The read finished after its slot began: start over from the playhead instead of piling windows onto now.
            next = Math.min(plan.length, at());
            t = null;
            continue;
          }
          let from = next;
          if (t === null || !state) {
            await c.resume();
            if (!current()) return;
            from = Math.max(next, Math.min(plan.length, at() + LEAD_MS));
            if (from >= to && to < plan.length) {
              next = from;   // the read took longer than the window: read again where the playhead is
              continue;
            }
            t = c.currentTime + LEAD_MS / 1000;
          }
          if (!state) {
            const master = c.createGain();
            const tail: AudioNode[] = [master];
            if (plan.level) {
              master.gain.value = (lufs != null ? gainTo(lufs) : 1) / SHAPER_RANGE;
              const clipper = c.createWaveShaper();
              clipper.curve = softClipCurve(SHAPER_RANGE);
              clipper.oversample = '2x';
              master.connect(clipper).connect(c.destination);
              tail.push(clipper);
            } else master.connect(c.destination);
            playing = state = { graphs: [], tail, clean };
          }
          // Windows that have finished playing let go of their sound.
          state.graphs = state.graphs.filter(({ graph, end }) => (end < c.currentTime ? (release(graph), false) : true));
          if (from < to) {
            const graph = schedule(c, full, (p) => read.get(p) ?? null, state.tail[0]!, { t0: t, from, to, clip: true, denoise: clean, levels: gains });
            t += (to - from) / 1000;
            state.graphs.push({ graph, end: t });
            const joins = full.parts.filter((p) => p.natural && read.has(p) && p.when < to && p.when + p.length > to);
            if (to < plan.length && joins.length) {
              const tailEnd = t + XFADE_MS / 1000;
              const overlap = schedule(c, { ...full, parts: joins }, (p) => read.get(p) ?? null, state.tail[0]!, { t0: t, from: to, to: to + XFADE_MS, clip: true, denoise: clean, levels: gains });
              state.graphs.push({ graph: overlap, end: tailEnd });
            }
          }
          if (to >= plan.length) return;
          next = to;
          const wait = (t - c.currentTime) * 1000 - AHEAD_MS;
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          if (!current()) return;
        }
      })().catch((error: unknown) => console.error('Klipkord: could not play audio', error));
    },
    stop,
    async measure(plan, cancelled = () => false) {
      const powers = new Map<string, Float64Array>();
      try {
        for (const id of new Set(plan.parts.map((p) => p.source))) {
          const p = await powersOf(id, cancelled);
          if (p) powers.set(id, p);
        }
      } catch (error) {
        if (error === cancelledError || cancelled()) return null;
        throw error;
      }
      if (cancelled()) return null;
      const clean = plan.parts.filter((p) => p.clean);
      const infos = clean.length ? await infosOf(clean.map((p) => p.source)) : new Map<string, SourceInfo>();
      const gains = await levelsOf(clean.filter((p) => infos.has(p.source)), infos);
      return cancelled() ? null : estimateLoudness(plan, powers, gains);
    },
    dispose() {
      stop();
      const node = rnnoise;
      rnnoise = null;
      // RNNoise holds wasm memory until destroyed.
      void node?.then((n) => (n as { destroy?: () => void } | undefined)?.destroy?.());
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
