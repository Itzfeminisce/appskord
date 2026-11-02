// The editor's live sound: the export's plan and graph (mix.ts), played from the playhead, so what you hear is what exports.
import { exportMix, type ExportOptions, type RangeLoader } from './export';
import { gainTo, LoudnessMeter } from './loudness';
import { loadBuffers, needsDenoise, startPreview, type MixPlan, type Preview, type StretchCache } from './mix';

export interface LiveDeps {
  /** Made on first play, at 48 kHz for noise removal. */
  context(): AudioContext;
  loader: RangeLoader;
  /** Noise removal; only called when the plan needs it, so RNNoise loads on first use. */
  denoise(ctx: BaseAudioContext): Promise<AudioNode>;
}

export interface LiveMix {
  /** Plays `plan` from the playhead `at()` reads once the sound is ready; `lufs` is the mix's measured loudness. */
  play(plan: MixPlan, at: () => number, lufs?: number | null): void;
  stop(): void;
  /** The mix's integrated loudness before "Even out the loudness", or null when it has no sound. */
  measure(plan: MixPlan, cancelled?: () => boolean): Promise<number | null>;
  dispose(): void;
}

// Stretched natural-voice parts are kept across plays, up to this many.
const STRETCH_CACHE = 64;

/** Integrated loudness of the plan as export renders it, without the level gain or noise removal. */
export async function measureMix(plan: MixPlan, loader: RangeLoader, cancelled = () => false, options: ExportOptions = {}): Promise<number | null> {
  const mix = await exportMix({ ...plan, level: false, denoise: false, parts: plan.parts.map((p) => (p.clean ? { ...p, clean: false } : p)) }, loader, { sampleRate: 24_000, ...options });
  if (!mix) return null;
  let meter: LoudnessMeter | null = null;
  for await (const chunk of mix) {
    if (cancelled()) return null;
    meter ??= new LoudnessMeter(chunk.sampleRate, chunk.data.length);
    meter.push(chunk.data);
  }
  const lufs = meter?.integrated() ?? null;
  return lufs !== null && Number.isFinite(lufs) ? lufs : null;
}

/** Whole decoded sources, read through the export's loader. */
function decoder(loader: RangeLoader) {
  const cache = new Map<string, Promise<AudioBuffer | null>>();
  return (id: string) => {
    let p = cache.get(id);
    if (!p) {
      p = loader.info(id).then((info) => (info ? loader.load(id, 0, info.duration) : null));
      p.catch(() => cache.delete(id));
      cache.set(id, p);
    }
    return p;
  };
}

export function liveMix(deps: LiveDeps): LiveMix {
  let ctx: AudioContext | null = null;
  const decode = decoder(deps.loader);
  const stretched: StretchCache = new Map();
  let playing: Preview | null = null;
  let run = 0;
  const stop = () => {
    run++;
    playing?.stop();
    playing = null;
  };
  return {
    play(plan, at, lufs) {
      stop();
      const mine = run;
      const c = (ctx ??= deps.context());
      void (async () => {
        const buffers = await loadBuffers(plan, decode);
        let denoise: AudioNode | undefined;
        if (needsDenoise(plan)) {
          denoise = await deps.denoise(c).catch((error: unknown) => {
            console.error('Klipkord: could not load noise removal', error);
            return undefined;
          });
        }
        if (c.state === 'suspended') await c.resume();
        if (mine !== run) {
          denoise?.disconnect();
          return;
        }
        if (stretched.size > STRETCH_CACHE) stretched.clear();
        // The sound starts 50 ms after scheduling (startPreview), where the playhead will be by then.
        playing = startPreview(c, plan, buffers, at() + 50, { gain: plan.level && lufs != null ? gainTo(lufs) : 1, denoise, stretched });
      })().catch((error: unknown) => console.error('Klipkord: could not play audio', error));
    },
    stop,
    measure: (plan, cancelled) => measureMix(plan, deps.loader, cancelled),
    dispose() {
      stop();
      stretched.clear();
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
