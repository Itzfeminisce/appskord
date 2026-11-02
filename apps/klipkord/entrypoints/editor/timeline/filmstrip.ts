/** One video file opened for thumbnails; frames are closed by the caller. */
export interface FrameSource {
  /** The frame at `t` seconds of the file, or null. */
  frameAt(t: number): Promise<VideoFrame | null>;
  close(): void;
}
export type OpenFrames = (blob: Blob) => Promise<FrameSource>;
export type Shrink = (frame: VideoFrame) => Promise<CanvasImageSource & { close?: () => void }>;

/** At most this many thumbnails per source, so a 30-minute recording costs no more than a short one. */
export const MAX_THUMBS = 400;
export const THUMB_W = 64;
export const THUMB_H = 36;

/** Thumbnail spacing (ms of the file) for a file `duration` ms long. */
export const thumbStep = (duration: number): number => Math.max(1000, Math.ceil(duration / MAX_THUMBS));

/** Coarse first: every 16th, then every 8th, … so the whole strip fills in early and sharpens after. */
export function passOrder(count: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let stride = 16; stride >= 1; stride /= 2) {
    for (let i = 0; i < count; i += stride) if (!seen.has(i)) { seen.add(i); out.push(i); }
  }
  return out;
}

// Kept for the life of the tab, so reopening the timeline or switching cuts never decodes again.
const caches = new Map<string, Map<number, CanvasImageSource>>();

const shrinkFrame: Shrink = (frame) => createImageBitmap(frame, { resizeWidth: THUMB_W, resizeHeight: THUMB_H, resizeQuality: 'low' });

export interface FilmstripOptions {
  /** Cache key: recording id and source id. */
  key: string;
  /** Length of the file, ms. */
  duration: number;
  load(): Promise<Blob>;
  open?: OpenFrames;
  shrink?: Shrink;
  /** Waits between frames; tests pass one that resolves at once. */
  rest?: (ms: number) => Promise<void>;
}

/**
 * A low-res frame pass over one video file, run in its own frames worker in the background.
 * It waits while the preview plays, so it never takes decode time from playback.
 */
export class Filmstrip {
  readonly step: number;
  private readonly thumbs: Map<number, CanvasImageSource>;
  private readonly listeners = new Set<() => void>();
  private playing = false;
  private stopped = false;
  private source: FrameSource | null = null;

  constructor(private readonly o: FilmstripOptions) {
    this.step = thumbStep(o.duration);
    let cache = caches.get(o.key);
    if (!cache) { cache = new Map(); caches.set(o.key, cache); }
    this.thumbs = cache;
  }

  /** The thumbnail nearest file time `t` (ms) that is ready, or undefined. */
  at(t: number): CanvasImageSource | undefined {
    const i = Math.round(t / this.step);
    return this.thumbs.get(i) ?? this.thumbs.get(i - 1) ?? this.thumbs.get(i + 1);
  }

  get count(): number { return this.thumbs.size; }

  setPlaying(playing: boolean): void { this.playing = playing; }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async run(): Promise<void> {
    const rest = this.o.rest ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const total = Math.max(1, Math.floor(this.o.duration / this.step) + 1);
    const todo = passOrder(total).filter((i) => !this.thumbs.has(i));
    if (todo.length === 0) return;
    try {
      const blob = await this.o.load();
      if (this.stopped) return;
      const open = this.o.open ?? (async (b: Blob) => (await import('./filmstripWorker')).openFrames(b));
      this.source = await open(blob);
      if (this.stopped) { this.source.close(); return; }
      for (const i of todo) {
        while (this.playing && !this.stopped) await rest(250);
        if (this.stopped) return;
        const frame = await this.source.frameAt((i * this.step) / 1000);
        if (!frame) continue;
        try {
          if (this.stopped) return;
          this.thumbs.set(i, await (this.o.shrink ?? shrinkFrame)(frame));
        } finally {
          frame.close();
        }
        this.listeners.forEach((l) => l());
        await rest(0);
      }
    } catch (error) {
      if (!this.stopped) console.error('Klipkord: could not draw the filmstrip', error);
    } finally {
      this.source?.close();
      this.source = null;
    }
  }

  dispose(): void {
    this.stopped = true;
    this.listeners.clear();
    this.source?.close();
    this.source = null;
  }
}
