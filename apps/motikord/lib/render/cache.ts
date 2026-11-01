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
  private families = new Set<string>();
  private pending = new Map<string, Promise<void>>();
  private fits = new Map<string, Fit>();
  private paints = new Map<string, unknown>();
  private tiles = new Map<number, OffscreenCanvas | null>();

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
    else if (asset.kind === 'font') { await (d.font ?? defaultFont)(asset.name, blob); this.fonts.add(asset.id); this.families.add(asset.name); }
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

  /** True once the family is usable, so fits measured on fallback metrics are not reused. */
  fontReady(family: string): boolean {
    if (this.families.has(family)) return true;
    try {
      const fonts = (globalThis as unknown as { fonts?: { check(f: string): boolean } }).fonts;
      return !!fonts?.check(`16px "${family.replace(/"/g, '')}"`);
    } catch { return false; }
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

  /** Memoises gradients, patterns and text layouts so a frame creates none it drew before. */
  paint<T>(key: string, make: () => T): T {
    if (this.paints.has(key)) return this.paints.get(key) as T;
    if (this.paints.size > 500) this.paints.clear();
    const p = make();
    this.paints.set(key, p);
    return p;
  }

  /** A seeded noise tile, made once; undefined where OffscreenCanvas does not exist. */
  grainTile(seed: number, size: number): OffscreenCanvas | undefined {
    if (!this.tiles.has(seed)) this.tiles.set(seed, makeGrain(seed, size));
    return this.tiles.get(seed) ?? undefined;
  }

  dispose() {
    for (const i of this.images.values()) i.close?.();
    for (const v of this.videos.values()) v.close?.();
    this.images.clear(); this.videos.clear(); this.audios.clear(); this.fonts.clear(); this.families.clear(); this.fits.clear(); this.paints.clear(); this.tiles.clear();
  }
}

function makeGrain(seed: number, size: number): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(size, size);
  let s = seed >>> 0;
  // mulberry32, so the tile is the same on every machine.
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand();
    // Light and dark specks in equal measure, so grain adds texture without greying the colour.
    const light = v >= 0.5 ? 255 : 0;
    img.data[i] = light; img.data[i + 1] = light; img.data[i + 2] = light;
    img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}
