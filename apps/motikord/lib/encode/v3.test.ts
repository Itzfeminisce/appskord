import { afterEach, describe, expect, it, vi } from 'vitest';

// No WebGL in unit tests: the drawer is a fake, so three.js is never needed.
vi.mock('../v3/frames', () => ({ ClipDrawer: class {} }));

import { writeCaptions } from '../../components/editor/CaptionsVoiceEdits';
import { sampleClip } from '../../components/editor/fixture';
import { initV3 } from '../../components/editor/model';
import { cancelExport, clearSession, getSession, type RenderHooks, type RunDeps } from '../exportJob';
import type { RenderItem } from '../exportPlan';
import { renderV3, startV3Export, type V3Env } from './v3';

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
class FakeDir {
  files = new Map<string, Blob>();
  dirs = new Map<string, FakeDir>();
  constructor(public name: string) {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    let d = this.dirs.get(name);
    if (!d) { if (!o?.create) throw notFound(); d = new FakeDir(name); this.dirs.set(name, d); }
    return d;
  }
  async getFileHandle(name: string) {
    return { createWritable: async () => { const parts: BlobPart[] = []; return new WritableStream({ write: (c) => { parts.push(c); }, close: () => { this.files.set(name, new Blob(parts)); } }); } };
  }
  async removeEntry(name: string) { this.dirs.delete(name); this.files.delete(name); }
}

function fakeEnv(o: { slow?: boolean } = {}) {
  const drawn: number[] = [];
  const log = { drawn, disposed: 0, encoded: 0, closedFrames: 0, gifFrames: 0 };
  const env: V3Env = {
    drawer: () => ({
      canvas: { width: 4, height: 4 } as never,
      draw: async (t) => { drawn.push(t); if (o.slow) await new Promise((r) => setTimeout(r, 1)); },
      dispose: () => { log.disposed++; },
    }),
    isSupported: async () => ({ supported: true }),
    makeEncoder: (init) => ({
      encodeQueueSize: 0,
      configure: () => undefined,
      encode: () => { log.encoded++; init.output({} as EncodedVideoChunk, undefined as never); },
      flush: async () => undefined,
      close: () => undefined,
    }),
    frame: () => ({ close: () => { log.closedFrames++; } }) as unknown as VideoFrame,
    pixels: (_s, w, h) => { log.gifFrames++; return new Uint8ClampedArray(w * h * 4); },
    muxer: () => ({ mime: 'video/mp4', addVideo: () => undefined, addAudio: () => undefined, finish: async () => new Blob(['video'], { type: 'video/mp4' }) }),
  };
  return { env, log };
}

const item = (o: Partial<RenderItem> = {}): RenderItem => ({
  aspect: '9:16', kind: 'mp4', quality: '1080p', file: 'a.mp4', label: 'x', width: 1080, height: 1920, fps: 30, frames: 6, durationMs: 200, audio: false, seeThrough: false, bitrate: 1, ...o,
});
const hooks = (): RenderHooks & { seen: number[] } => {
  const seen: number[] = [];
  return { seen, progress: (f) => seen.push(f), encoder: () => undefined };
};

afterEach(() => clearSession());

describe('v3 export renderer', () => {
  it('draws every frame in order, encodes each one, and frees the drawer', async () => {
    const { env, log } = fakeEnv();
    const h = hooks();
    const blob = await renderV3(sampleClip().v3, undefined, item(), undefined, h, env).done;
    expect(blob.type).toBe('video/mp4');
    expect(log.drawn).toEqual([0, 1, 2, 3, 4, 5].map((i) => (i * 1000) / 30));
    expect([log.encoded, log.closedFrames, log.disposed]).toEqual([6, 6, 1]);
    expect(h.seen.at(-1)).toBe(6);
  });

  it('writes GIF frames from the drawn pixels', async () => {
    const { env, log } = fakeEnv();
    const blob = await renderV3(sampleClip().v3, undefined, item({ kind: 'gif', width: 4, height: 4, fps: 15, frames: 3 }), undefined, hooks(), env).done;
    expect(blob.type).toBe('image/gif');
    expect(log.gifFrames).toBe(3);
  });

  it('stops on Cancel and still releases the drawer', async () => {
    const { env, log } = fakeEnv({ slow: true });
    const run = renderV3(sampleClip().v3, undefined, item({ frames: 500 }), undefined, hooks(), env);
    await new Promise((r) => setTimeout(r, 5));
    run.cancel();
    await expect(run.done).rejects.toMatchObject({ name: 'Cancelled' });
    expect(log.drawn.length).toBeLessThan(500);
    expect(log.disposed).toBe(1);
  });

  it('runs as an export job: saves each size and a separate .srt into a new folder', async () => {
    const clip = writeCaptions(initV3(sampleClip()), [{ startMs: 100, endMs: 900, text: 'Hello there' }], 'line', 'Auto captions added').clip;
    const root = new FakeDir('Motikord clips');
    const { env } = fakeEnv();
    const badges: (number | null)[] = [];
    const deps = { root, now: () => 1, badge: (p: number | null) => badges.push(p), mix: async () => undefined, saveJob: async () => undefined, removeJob: async () => undefined, markExported: async () => undefined, objectUrl: () => 'blob:x', render: () => { throw new Error('replaced'); } } as unknown as RunDeps;
    const s = await startV3Export({ clip, choice: { kind: 'mp4', aspects: ['9:16', '1:1'], fps: 60, finishing: true, captions: 'srt' }, fps: 30, root: root as never, deps, env });
    expect(s.phase).toBe('done');
    expect(s.items.map((i) => i.item.fps)).toEqual([30, 30]);
    const dir = [...root.dirs.values()][0]!;
    expect([...dir.files.keys()].sort()).toEqual(expect.arrayContaining([expect.stringMatching(/9x16\.mp4$/), expect.stringMatching(/1x1\.mp4$/), expect.stringMatching(/\.srt$/)]));
    const srt = [...dir.files.entries()].find(([n]) => n.endsWith('.srt'))![1];
    expect(await srt.text()).toContain('Hello there');
    expect(badges.at(-1)).toBeNull();
  });

  it('Cancel during a job ends it cancelled with nothing left in the folder', async () => {
    const root = new FakeDir('Motikord clips');
    const { env, log } = fakeEnv({ slow: true });
    const deps = { root, now: () => 1, badge: () => undefined, mix: async () => undefined, saveJob: async () => undefined, removeJob: async () => undefined, markExported: async () => undefined, render: () => { throw new Error('replaced'); } } as unknown as RunDeps;
    const run = startV3Export({ clip: sampleClip(), choice: { kind: 'webm', aspects: ['9:16'], fps: 30, finishing: true, captions: 'off' }, fps: 30, root: root as never, deps, env });
    await new Promise((r) => setTimeout(r, 10));
    cancelExport();
    const s = await run;
    expect(s.phase).toBe('cancelled');
    expect(getSession()?.phase).toBe('cancelled');
    expect(root.dirs.size).toBe(0);
    expect(log.disposed).toBe(1);
  });
});
