import { describe, expect, it } from 'vitest';
import { audioParts, pickAudioCodec } from './audio';
import { Cancelled, pickVideoConfig, runFrames, videoTrack, type EncoderLike, type Muxed } from './video';
import type { Recipe } from '../types';

const spec = { kind: 'webm-alpha' as const, width: 720, height: 1280, fps: 30, bitrate: 1 };

describe('encode', () => {
  it('prefers the video chip, falls back to software, and reports no alpha support', async () => {
    const hw = await pickVideoConfig({ ...spec, kind: 'mp4' }, async () => ({ supported: true }));
    expect([hw?.hardware, hw?.config.codec, hw?.config.avc]).toEqual([true, 'avc1.640028', { format: 'avc' }]);
    const sw = await pickVideoConfig(spec, async (c) => ({ supported: c.hardwareAcceleration === 'prefer-software' }));
    expect([sw?.hardware, sw?.config.alpha, sw?.config.codec]).toEqual([false, 'keep', 'vp09.00.10.08']);
    expect(await pickVideoConfig(spec, async (c) => ({ supported: c.alpha !== 'keep' }))).toBeNull();
  });

  it('uses AAC in MP4, Opus in MP4 when AAC is missing, and Opus in WebM', async () => {
    expect((await pickAudioCodec('mp4', async () => ({ supported: true })))?.codec).toBe('aac');
    expect((await pickAudioCodec('mp4', async (c) => ({ supported: c.codec === 'opus' })))?.codec).toBe('opus');
    expect((await pickAudioCodec('webm', async (c) => ({ supported: c.codec !== 'opus' })))).toBeNull();
  });

  it('draws and encodes every frame in order, with progress about 4 times a second', async () => {
    const seen: string[] = [];
    const progress: number[] = [];
    let t = 0;
    await runFrames({
      frames: 10, fps: 10, cancelled: () => false, now: () => (t += 100),
      prepare: async (i) => { seen.push(`p${i}`); }, draw: (i) => seen.push(`d${i}`), encode: (i) => { seen.push(`e${i}`); },
      progress: (f) => progress.push(f),
    });
    expect(seen.slice(0, 6)).toEqual(['p0', 'd0', 'e0', 'p1', 'd1', 'e1']);
    expect(progress).toEqual([1, 4, 7, 10]);
  });

  it('stops on Cancel', async () => {
    let n = 0;
    await expect(runFrames({ frames: 100, fps: 30, cancelled: () => n >= 3, draw: () => { n++; }, encode: () => undefined, progress: () => undefined })).rejects.toBeInstanceOf(Cancelled);
    expect(n).toBe(3);
  });

  it('feeds a fake encoder, keys every 2 s, and passes chunks to the muxer', async () => {
    const chunks: unknown[] = [];
    const keys: boolean[] = [];
    const mux: Muxed = { mime: 'video/mp4', addVideo: (c) => chunks.push(c), addAudio: () => undefined, finish: () => new ArrayBuffer(0) };
    let init: VideoEncoderInit | undefined;
    const fake: EncoderLike = { encodeQueueSize: 0, configure: () => undefined, encode: (_f, o) => { keys.push(!!o?.keyFrame); init!.output({} as EncodedVideoChunk); }, flush: async () => undefined, close: () => undefined };
    const track = videoTrack({ codec: 'avc1.640028', width: 2, height: 2, framerate: 30 }, mux, (i) => { init = i; return fake; });
    const frame = () => ({ close: () => undefined }) as unknown as VideoFrame;
    for (let i = 0; i < 61; i++) await track.add(frame(), i);
    await track.done();
    expect(chunks).toHaveLength(61);
    expect(keys.filter(Boolean)).toHaveLength(2);
  });

  it('places music over the whole clip and unmuted video layers where they play', () => {
    const r = {
      version: 1, id: 'r', name: 'n', type: 'promo', aspect: '9:16',
      assets: { m: { id: 'm', kind: 'audio' }, v: { id: 'v', kind: 'video' } },
      music: { assetId: 'm', volume: 0.5, fadeInMs: 500, fadeOutMs: 1000 },
      scenes: [
        { id: 's1', durationMs: 3000, background: '#fff', layout: 'center', layers: [] },
        { id: 's2', durationMs: 4000, background: '#fff', layout: 'center', layers: [
          { id: 'a', name: 'a', type: 'video', assetId: 'v', fit: 'cover', startMs: 1000, endMs: 3000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } },
          { id: 'b', name: 'b', type: 'video', assetId: 'v', fit: 'cover', startMs: 0, endMs: 4000, opacity: 1, muted: true, box: { x: 0, y: 0, w: 1, h: 1 } },
        ] },
      ],
    } as unknown as Recipe;
    expect(audioParts(r, 9000)).toEqual([
      { assetId: 'm', atSec: 0, durSec: 9, gain: 0.5, fadeInSec: 0.5, fadeOutSec: 1, loop: true },
      { assetId: 'v', atSec: 4, durSec: 2, gain: 1, fadeInSec: 0, fadeOutSec: 0, loop: false },
    ]);
  });
});
