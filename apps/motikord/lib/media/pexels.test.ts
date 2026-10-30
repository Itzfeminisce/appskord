import { describe, expect, it, vi } from 'vitest';
import { searchPexels } from './pexels';

const photo = { id: 7, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/7/', photographer: 'Bo', alt: 'Baker shaping dough', src: { original: 'https://images.pexels.com/o.jpg', large2x: 'https://images.pexels.com/l.jpg', medium: 'https://images.pexels.com/m.jpg' } };
const video = {
  id: 9, width: 1920, height: 1080, url: 'https://www.pexels.com/video/9/', duration: 12, image: 'https://images.pexels.com/v.jpg', user: { name: 'Cy' },
  video_files: [{ file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://videos.pexels.com/4k.mp4' }, { file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://videos.pexels.com/hd.mp4' }, { file_type: 'video/webm', width: 640, height: 360, link: 'https://videos.pexels.com/s.webm' }],
};

describe('searchPexels', () => {
  it('sends the key as the Authorization header only', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ photos: [photo] })));
    const [r] = await searchPexels(f, 'pexels_test', 'bread', 'image');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('pexels_test');
    expect(init.headers).toEqual({ Authorization: 'pexels_test' });
    expect(r).toMatchObject({ source: 'pexels', kind: 'image', licence: 'pexels', author: 'Bo', title: 'Baker shaping dough', downloadUrl: 'https://images.pexels.com/l.jpg' });
  });
  it('picks an mp4 up to 1080p for a video', async () => {
    const [r] = await searchPexels(vi.fn(async () => new Response(JSON.stringify({ videos: [video] }))), 'pexels_test', 'bread', 'video');
    expect(r).toMatchObject({ kind: 'video', downloadUrl: 'https://videos.pexels.com/hd.mp4', durationMs: 12000, mime: 'video/mp4' });
  });
  it('reports a refused key and no connection', async () => {
    await expect(searchPexels(vi.fn(async () => new Response('', { status: 401 })), 'pexels_test', 'q', 'image')).rejects.toMatchObject({ reason: 'key' });
    await expect(searchPexels(vi.fn(async () => { throw new TypeError('x'); }), 'pexels_test', 'q', 'image')).rejects.toMatchObject({ reason: 'offline' });
  });
});
