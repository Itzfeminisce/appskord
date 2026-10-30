import type { Asset, Recipe } from '../types';
import type { Fit } from './textFit';

/** A decoded video the renderer can ask for the frame at a time; T11 backs it with WebCodecs, the preview may use a video element. */
export interface VideoSource { frameAt(ms: number): CanvasImageSource | undefined; close?(): void }

/** How bytes become drawable things. Injected so the cache runs in a page, a worker or a test. */
export interface Decoders {
  read(asset: Asset): Promise<Blob | undefined>;
  image?(blob: Blob): Promise<CanvasImageSource & { close?(): void }>;
  video?(asset: Asset, blob: Blob): Promise<VideoSource>;
  font?(family: string, blob: Blob): Promise<void>;
  audio?(blob: Blob): Promise<unknown>;
}

type Drawable = CanvasImageSource & { close?(): void };

const defaultImage = (blob: Blob) => createImageBitmap(blob);
// FontFace and the fonts set exist in pages and workers alike, so this needs no DOM.
async function defaultFont(family: string, blob: Blob) {
  const face = new FontFace(family, await blob.arrayBuffer());
  await face.load();
  (self as unknown as { fonts: FontFaceSet }).fonts.add(face);
}

/** Decodes each asset once and keeps it for every frame; also memoises text fits, which are costly to redo per frame. */
export class MediaCache {
  private images = new Map<string, Drawable>();
  private videos = new Map<string, VideoSource>();
  private audios = new Map<string, unknown>();
  private fonts = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private fits = new Map<string, Fit>();

  constructor(private decoders?: Decoders) {}

  /** Loads every asset the recipe uses that is not decoded yet. Failures are logged and the layer is skipped when drawn. */
  async load(recipe: Recipe): Promise<void> {
    await Promise.all(Object.values(recipe.assets).map((a) => this.loadAsset(a)));
  }

  loadAsset(asset: Asset): Promise<void> {
    if (this.has(asset.id) || !this.decoders) return Promise.resolve();
    let job = this.pending.get(asset.id);
    if (!job) {
      job = this.decode(asset, this.decoders)
        .catch((error) => console.error('Motikord: could not decode media', error))
        .finally(() => this.pending.delete(asset.id));
      this.pending.set(asset.id, job);
    }
    return job;
  }

  private async decode(asset: Asset, d: Decoders) {
    const blob = await d.read(asset);
    if (!blob) return;
    if (asset.kind === 'image' || asset.kind === 'logo') this.images.set(asset.id, await (d.image ?? defaultImage)(blob));
    else if (asset.kind === 'video' && d.video) this.videos.set(asset.id, await d.video(asset, blob));
    else if (asset.kind === 'font') { await (d.font ?? defaultFont)(asset.name, blob); this.fonts.add(asset.id); }
    else if (asset.kind === 'audio' && d.audio) this.audios.set(asset.id, await d.audio(blob));
  }

  has(id: string) { return this.images.has(id) || this.videos.has(id) || this.audios.has(id) || this.fonts.has(id); }
  setImage(id: string, image: Drawable) { this.images.set(id, image); }
  setVideo(id: string, video: VideoSource) { this.videos.set(id, video); }
  image(id: string): CanvasImageSource | undefined { return this.images.get(id); }
  videoFrame(id: string, ms: number): CanvasImageSource | undefined { return this.videos.get(id)?.frameAt(ms); }
  audio(id: string): unknown { return this.audios.get(id); }

  private scratchCtx?: OffscreenCanvasRenderingContext2D | null;

  /** A reused offscreen canvas of at least w x h for effects; undefined where OffscreenCanvas does not exist. */
  scratch(w: number, h: number): OffscreenCanvasRenderingContext2D | undefined {
    if (typeof OffscreenCanvas === 'undefined') return undefined;
    const c = this.scratchCtx?.canvas;
    if (!c || c.width < w || c.height < h) {
      this.scratchCtx = new OffscreenCanvas(Math.max(w, c?.width ?? 0), Math.max(h, c?.height ?? 0)).getContext('2d');
    }
    return this.scratchCtx ?? undefined;
  }

  fit(key: string, make: () => Fit): Fit {
    let f = this.fits.get(key);
    if (!f) {
      // Edits change text often; a cap keeps a long session from growing without bound.
      if (this.fits.size > 500) this.fits.clear();
      f = make();
      this.fits.set(key, f);
    }
    return f;
  }

  dispose() {
    for (const i of this.images.values()) i.close?.();
    for (const v of this.videos.values()) v.close?.();
    this.images.clear(); this.videos.clear(); this.audios.clear(); this.fonts.clear(); this.fits.clear();
  }
}
