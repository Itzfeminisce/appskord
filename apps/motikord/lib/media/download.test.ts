import { describe, expect, it, vi } from 'vitest';
import { applyPatch } from '../patch';
import type { Recipe } from '../types';
import { addMediaEdit, downloadResult, DownloadError } from './download';
import type { MediaResult } from './openverse';

const result: MediaResult = {
  id: 'a1', source: 'openverse', kind: 'image', title: 'Loaf on a wooden board', author: 'Ada', licence: 'cc-by', licenceLabel: 'CC BY 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', pageUrl: 'https://www.flickr.com/photos/a1', thumbnail: '', downloadUrl: 'https://live.staticflickr.com/a1.jpg', width: 2400, height: 1600,
};
const recipe = (): Recipe => ({ version: 1, id: 'c', name: 'Promo', type: 'promo', aspect: '9:16', assets: {}, scenes: [{ id: 's1', durationMs: 5000, background: '#fff', layout: 'x', layers: [] }] });

describe('downloadResult', () => {
  it('downloads once, keeps the file in OPFS and records the full credit', async () => {
    const put = vi.fn(async () => undefined);
    const fetch = vi.fn(async () => new Response(new Blob(['x'], { type: 'image/jpeg' })));
    const asset = await downloadResult(result, { fetch, put, id: 'id1' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('media/id1.jpg', expect.any(Blob));
    expect(asset).toMatchObject({ id: 'id1', kind: 'image', opfsPath: 'media/id1.jpg', credit: { title: 'Loaf on a wooden board', author: 'Ada', source: 'openverse', url: 'https://www.flickr.com/photos/a1', licence: 'cc-by' } });
  });
  it('fails cleanly when the host refuses or is unreachable', async () => {
    const put = vi.fn(async () => undefined);
    await expect(downloadResult(result, { fetch: async () => new Response('', { status: 403 }), put })).rejects.toBeInstanceOf(DownloadError);
    await expect(downloadResult(result, { fetch: async () => { throw new TypeError('cors'); }, put })).rejects.toBeInstanceOf(DownloadError);
    expect(put).not.toHaveBeenCalled();
  });
});

describe('downloadResult size cap', () => {
  it('refuses a declared size over the cap without reading the body', async () => {
    const put = vi.fn(async () => undefined);
    const res = new Response('x', { headers: { 'content-length': '500', 'content-type': 'image/jpeg' } });
    await expect(downloadResult(result, { fetch: async () => res, put, maxBytes: 100 })).rejects.toBeInstanceOf(DownloadError);
    expect(put).not.toHaveBeenCalled();
  });
  it('cancels a stream as soon as it passes the cap', async () => {
    const put = vi.fn(async () => undefined);
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { pulled++; c.enqueue(new Uint8Array(40)); },
      cancel() { cancelled = true; },
    });
    await expect(downloadResult(result, { fetch: async () => new Response(body, { headers: { 'content-type': 'image/jpeg' } }), put, maxBytes: 100 })).rejects.toBeInstanceOf(DownloadError);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
    expect(put).not.toHaveBeenCalled();
  });
  it('keeps a streamed file under the cap with its real size', async () => {
    const asset = await downloadResult(result, { fetch: async () => new Response(new Uint8Array(60), { headers: { 'content-type': 'image/png' } }), put: async () => undefined, id: 'id3', maxBytes: 100 });
    expect(asset).toMatchObject({ bytes: 60, mime: 'image/png', opfsPath: 'media/id3.png' });
  });
});

describe('addMediaEdit', () => {
  it('adds the asset and a layer in one edit', async () => {
    const asset = await downloadResult(result, { fetch: async () => new Response(new Blob(['x'], { type: 'image/png' })), put: async () => undefined, id: 'id2' });
    const edit = addMediaEdit(recipe(), 's1', asset, 'L1')!;
    const next = applyPatch(recipe(), edit.ops).doc;
    expect(next.assets.id2?.credit?.licence).toBe('cc-by');
    expect(next.scenes[0]!.layers[0]).toMatchObject({ type: 'image', assetId: 'id2', endMs: 5000 });
  });
});
