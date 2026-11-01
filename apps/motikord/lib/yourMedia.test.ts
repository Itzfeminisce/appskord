import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getBrandKit } from './db';
import type { Asset } from './types';
import { addFiles, classifyFile, defaultMediaDeps, describeMedia, displayName, type MediaDeps } from './yourMedia';

const file = (name: string, type = '', size = 1000) => new File([new Uint8Array(size)], name, { type });

function deps(over: Partial<MediaDeps> = {}) {
  let store: Asset[] = [];
  let n = 0;
  const put: string[] = [];
  const fonts: string[] = [];
  const d: MediaDeps = {
    put: async (p) => { put.push(p); },
    probe: async () => ({ width: 10, height: 20 }),
    loadFont: async (f) => { fonts.push(f); },
    addToBrandKit: defaultMediaDeps.addToBrandKit,
    read: async () => store,
    write: async (items) => { store = items; },
    id: () => `m${++n}`,
    ...over,
  };
  return { d, put, fonts, get store() { return store; } };
}

describe('classifyFile', () => {
  it('sorts the supported types', () => {
    expect(classifyFile(file('a.jpg'))).toBe('image');
    expect(classifyFile(file('a.PNG'))).toBe('image');
    expect(classifyFile(file('a.webp'))).toBe('image');
    expect(classifyFile(file('mark.svg'))).toBe('logo');
    expect(classifyFile(file('Logo.png'))).toBe('logo');
    expect(classifyFile(file('a.mp4'))).toBe('video');
    expect(classifyFile(file('a.webm'))).toBe('video');
    expect(classifyFile(file('a.mp3'))).toBe('audio');
    expect(classifyFile(file('a.wav'))).toBe('audio');
    for (const ext of ['ttf', 'otf', 'woff2']) expect(classifyFile(file(`a.${ext}`))).toBe('font');
  });
  it('turns away everything else', () => {
    expect(classifyFile(file('brochure.pdf', 'application/pdf'))).toBeUndefined();
    expect(classifyFile(file('notes.txt'))).toBeUndefined();
    expect(classifyFile(file('anim.gif', 'image/gif'))).toBeUndefined();
  });
});

describe('addFiles', () => {
  afterEach(async () => { await closeDB(); indexedDB.deleteDatabase('motikord'); });

  it('stores files, keeps them for later and adds a logo to the brand kit', async () => {
    const t = deps();
    const { added, rejected } = await addFiles([file('loaf.jpg', 'image/jpeg'), file('logo.svg', 'image/svg+xml'), file('Fraunces.ttf')], t.d);
    expect(rejected).toEqual([]);
    expect(added.map((a) => a.kind)).toEqual(['image', 'logo', 'font']);
    expect(added[0]).toMatchObject({ id: 'm1', mime: 'image/jpeg', bytes: 1000, width: 10, opfsPath: 'media/m1.jpg' });
    expect(added[0]!.credit).toBeUndefined();
    expect(t.put).toEqual(['media/m1.jpg', 'media/m2.svg', 'media/m3.ttf']);
    expect(t.fonts).toEqual(['Fraunces']);
    expect(added[2]!.name).toBe('Fraunces');
    expect(displayName(added[2]!)).toBe('Fraunces.ttf');
    expect((await getBrandKit())?.logoAssetId).toBe('m2');
    expect(t.store).toHaveLength(3);
    await addFiles([file('b.png')], t.d);
    expect(t.store).toHaveLength(4);
    expect(t.store[0]!.name).toBe('b.png');
  });

  it('reports unsupported files and still adds the others', async () => {
    const t = deps();
    const { added, rejected } = await addFiles([file('brochure.pdf', 'application/pdf'), file('a.jpg')], t.d);
    expect(rejected).toEqual([{ name: 'brochure.pdf', problem: 'media-unsupported' }]);
    expect(added).toHaveLength(1);
  });

  it('reports a video Chrome cannot play and does not keep it', async () => {
    const t = deps({ probe: async (_f, kind) => { if (kind === 'video') throw new Error('x'); return {}; } });
    const { added, rejected } = await addFiles([file('drone-shot.mov', 'video/quicktime'), file('a.mp3')], t.d);
    expect(rejected).toEqual([{ name: 'drone-shot.mov', problem: 'video-wont-play' }]);
    expect(added.map((a) => a.name)).toEqual(['a.mp3']);
    expect(t.put).toEqual(['media/m1.mp3']);
  });

  it('describes rows like the frame', () => {
    const base = { id: 'x', mime: '', opfsPath: 'media/x.mp4' };
    expect(describeMedia({ ...base, kind: 'image', name: 'a', bytes: 2_100_000 })).toBe('Image · 2.1 MB');
    expect(describeMedia({ ...base, kind: 'video', name: 'a', bytes: 18_000_000, durationMs: 12000 })).toBe('Video · 0:12 · 18 MB');
    expect(describeMedia({ ...base, kind: 'audio', name: 'a', bytes: 1, durationMs: 30000 })).toBe('Music · 0:30');
    expect(describeMedia({ ...base, kind: 'logo', name: 'a', bytes: 1 })).toBe('Logo · added to your brand kit');
    expect(describeMedia({ ...base, kind: 'font', name: 'a', bytes: 1 })).toBe('Font · ready to use');
  });
});

describe('addFiles brand kit failure', () => {
  it('keeps the logo and the rest of the batch when the brand kit throws', async () => {
    const t = deps({ addToBrandKit: async () => { throw new Error('db'); } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { added, rejected } = await addFiles([file('mark.svg'), file('a.jpg')], t.d);
    expect(added.map((a) => a.name)).toEqual(['mark.svg', 'a.jpg']);
    expect(rejected).toEqual([]);
    expect(t.store).toHaveLength(2);
    expect(log).toHaveBeenCalledWith('Motikord: could not add the logo to the brand kit', expect.any(Error));
    log.mockRestore();
  });
});
