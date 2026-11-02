import type { Fit } from './textFit';

/** What a host gives drawScene: decoded images by asset id and font readiness. Motikord's MediaCache is one. */
export interface SceneCache {
  image(id: string): CanvasImageSource | undefined;
  fontReady(family: string, weight: number): boolean;
}

/** Everything the renderer asks of its cache: the host's media plus memos for fits, paints and effects. */
export interface RenderCache extends SceneCache {
  videoFrame(id: string, ms: number): CanvasImageSource | undefined;
  scratch(w: number, h: number): OffscreenCanvasRenderingContext2D | undefined;
  fit(key: string, make: () => Fit): Fit;
  paint<T>(key: string, make: () => T): T;
  grainTile(seed: number, size: number): OffscreenCanvas | undefined;
}

interface FontSet {
  check(f: string): boolean;
  load?(f: string): Promise<unknown>;
}

const isRenderCache = (c: SceneCache): c is RenderCache =>
  (['videoFrame', 'scratch', 'fit', 'paint', 'grainTile'] as const).every(
    (k) => typeof (c as Partial<RenderCache>)[k] === 'function',
  );

/** A RenderCache over a host's SceneCache (or none), keeping the memos a frame reuses. */
export class SceneMemo implements RenderCache {
  private fits = new Map<string, Fit>();
  private paints = new Map<string, unknown>();
  private tiles = new Map<number, OffscreenCanvas | null>();
  private scratchCtx?: OffscreenCanvasRenderingContext2D | null;
  private asked = new Set<string>();

  constructor(private host?: SceneCache) {}

  image(id: string): CanvasImageSource | undefined {
    return this.host?.image(id);
  }
  videoFrame(): CanvasImageSource | undefined {
    return undefined;
  }

  fontReady(family: string, weight: number): boolean {
    if (this.host) return this.host.fontReady(family, weight);
    try {
      const g = globalThis as unknown as { fonts?: FontSet; document?: { fonts?: FontSet } };
      const fonts = g.document?.fonts ?? g.fonts;
      const name = `"${family.replace(/"/g, '')}"`;
      if (fonts?.check(`${weight} 16px ${name}`)) return true;
      // Canvas text never asks for a face, so the first draw does.
      if (fonts?.load && !this.asked.has(family)) {
        this.asked.add(family);
        for (const w of [400, 500, 600, 700]) fonts.load(`${w} 16px ${name}`).catch(() => undefined);
      }
      return false;
    } catch {
      return false;
    }
  }

  scratch(w: number, h: number): OffscreenCanvasRenderingContext2D | undefined {
    if (typeof OffscreenCanvas === 'undefined') return undefined;
    const c = this.scratchCtx?.canvas;
    if (!c || c.width < w || c.height < h) {
      this.scratchCtx = new OffscreenCanvas(Math.max(w, c?.width ?? 0), Math.max(h, c?.height ?? 0)).getContext('2d');
    }
    return this.scratchCtx ?? undefined;
  }

  fit(key: string, make: () => Fit): Fit {
    return this.memo(this.fits, key, make);
  }
  paint<T>(key: string, make: () => T): T {
    return this.memo(this.paints, key, make) as T;
  }
  grainTile(seed: number, size: number): OffscreenCanvas | undefined {
    if (!this.tiles.has(seed)) this.tiles.set(seed, makeGrain(seed, size));
    return this.tiles.get(seed) ?? undefined;
  }

  private memo<T>(map: Map<string, T>, key: string, make: () => T): T {
    if (map.has(key)) return map.get(key) as T;
    if (map.size > 500) map.clear();
    const v = make();
    map.set(key, v);
    return v;
  }
}

const memos = new WeakMap<SceneCache, RenderCache>();
let bare: SceneMemo | undefined;

/** The host's cache when it already memoises (a MediaCache), else one SceneMemo kept per host. */
export function renderCacheFor(cache?: SceneCache): RenderCache {
  if (!cache) return (bare ??= new SceneMemo());
  if (isRenderCache(cache)) return cache;
  let m = memos.get(cache);
  if (!m) memos.set(cache, (m = new SceneMemo(cache)));
  return m;
}

/** A seeded noise tile, the same on every machine; null where OffscreenCanvas does not exist. */
export function makeGrain(seed: number, size: number): OffscreenCanvas | null {
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
    img.data[i] = light;
    img.data[i + 1] = light;
    img.data[i + 2] = light;
    img.data[i + 3] = Math.round(Math.abs(v - 0.5) * 2 * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}
