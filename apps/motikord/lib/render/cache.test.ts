import { describe, expect, it, vi } from 'vitest';
import type { Asset, Recipe } from '../types';
import { MediaCache, type Decoders } from './cache';

const asset = (id: string, kind: Asset['kind']): Asset => ({ id, kind, name: id, mime: 'x/y', bytes: 1, opfsPath: `media/${id}` });
const recipe = (assets: Asset[]): Recipe => ({ version: 1, id: 'r', name: 'r', type: 'promo', aspect: '16:9', scenes: [], assets: Object.fromEntries(assets.map((a) => [a.id, a])) });

function decoders() {
  const read = vi.fn(async (a: Asset) => new Blob([a.id]));
  const image = vi.fn(async () => ({ width: 4, height: 3, close: vi.fn() }) as unknown as ImageBitmap);
  const video = vi.fn(async () => ({ frameAt: (ms: number) => ({ width: ms, height: 1 }) as unknown as ImageBitmap }));
  const font = vi.fn(async () => {});
  const audio = vi.fn(async () => 'pcm');
  return { read, image, video, font, audio } satisfies Decoders;
}

describe('MediaCache', () => {
  it('decodes each asset once across loads and frames', async () => {
    const d = decoders();
    const cache = new MediaCache(d);
    const r = recipe([asset('i', 'image'), asset('v', 'video'), asset('f', 'font'), asset('a', 'audio'), asset('l', 'logo')]);
    await Promise.all([cache.load(r), cache.load(r)]);
    await cache.load(r);
    expect(d.read).toHaveBeenCalledTimes(5);
    expect(d.image).toHaveBeenCalledTimes(2);
    expect(cache.image('i')).toBeDefined();
    expect(cache.videoFrame('v', 40)).toMatchObject({ width: 40 });
    expect(cache.audio('a')).toBe('pcm');
    expect(cache.has('f')).toBe(true);
  });

  it('logs a failed decode and keeps going', async () => {
    const d = decoders();
    d.image.mockRejectedValueOnce(new Error('bad file'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cache = new MediaCache(d);
    await cache.load(recipe([asset('i', 'image'), asset('a', 'audio')]));
    expect(spy).toHaveBeenCalledWith('Motikord: could not decode media', expect.any(Error));
    expect(cache.image('i')).toBeUndefined();
    expect(cache.audio('a')).toBe('pcm');
    spy.mockRestore();
  });

  it('memoises text fits and closes bitmaps on dispose', async () => {
    const d = decoders();
    const cache = new MediaCache(d);
    await cache.load(recipe([asset('i', 'image')]));
    const make = vi.fn(() => ({ sizePx: 10, lines: ['a'], fits: true }));
    cache.fit('k', make);
    cache.fit('k', make);
    expect(make).toHaveBeenCalledTimes(1);
    const img = cache.image('i') as unknown as { close: () => void };
    cache.dispose();
    expect(img.close).toHaveBeenCalled();
    expect(cache.image('i')).toBeUndefined();
  });

  it('reports a font family ready only after it loads', async () => {
    const cache = new MediaCache(decoders());
    expect(cache.fontReady('f')).toBe(false);
    await cache.load(recipe([asset('f', 'font')]));
    expect(cache.fontReady('f')).toBe(true);
  });
});
