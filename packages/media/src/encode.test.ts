import { describe, expect, it } from 'vitest';
import { chooseCodecs, createWriter, type CodecSupport } from './encode';

const all: CodecSupport = { avc: true, vp9: true, vp8: true, aac: true, opus: true };

describe('chooseCodecs', () => {
  it('writes MP4 as H.264 and AAC', () => {
    expect(chooseCodecs('mp4', all, true)).toEqual({ video: 'avc', audio: 'aac' });
  });
  it('falls back to Opus in MP4 without an AAC encoder', () => {
    expect(chooseCodecs('mp4', { ...all, aac: false }, true)).toEqual({ video: 'avc', audio: 'opus' });
  });
  it('cannot write MP4 without H.264', () => {
    expect(chooseCodecs('mp4', { ...all, avc: false }, true)).toBeNull();
  });
  it('writes WebM as VP9 and Opus, else VP8', () => {
    expect(chooseCodecs('webm', all, true)).toEqual({ video: 'vp9', audio: 'opus' });
    expect(chooseCodecs('webm', { ...all, vp9: false }, true)).toEqual({ video: 'vp8', audio: 'opus' });
  });
  it('never puts AAC in WebM', () => {
    expect(chooseCodecs('webm', { ...all, opus: false }, true)).toBeNull();
  });
  it('leaves audio out of a silent export', () => {
    expect(chooseCodecs('webm', { ...all, opus: false }, false)).toEqual({ video: 'vp9', audio: null });
  });
});

describe('createWriter', () => {
  const options = { width: 1280, height: 720, fps: 30, bitrate: 5_000_000, audio: { sampleRate: 48_000, channels: 2 } };
  const deps = (support: Partial<CodecSupport>) => ({
    canEncodeVideo: async (codec: string) => support[codec as keyof CodecSupport] ?? false,
    canEncodeAudio: async (codec: string) => support[codec as keyof CodecSupport] ?? false,
  });

  it('picks codecs from what the browser can encode', async () => {
    const writer = await createWriter({ ...options, container: 'mp4' }, deps({ avc: true, opus: true }));
    expect(writer.codecs).toEqual({ video: 'avc', audio: 'opus' });
    expect(writer.mimeType).toBe('video/mp4');
    expect(writer.audio).not.toBeNull();
  });

  it('hands frames to the encoder as they are, with no resize copy', async () => {
    const writer = await createWriter({ ...options, container: 'mp4' }, deps({ avc: true, opus: true }));
    const config = (writer.video as unknown as { _encoder: { encodingConfig: { transform?: unknown } } })._encoder.encodingConfig;
    expect(config.transform).toBeUndefined();
  });

  it('has no audio track for a silent export', async () => {
    const writer = await createWriter({ ...options, container: 'webm', audio: false }, deps({ vp8: true }));
    expect(writer.codecs).toEqual({ video: 'vp8', audio: null });
    expect(writer.audio).toBeNull();
  });

  it('refuses a container it cannot encode', async () => {
    await expect(createWriter({ ...options, container: 'mp4' }, deps({ vp9: true, opus: true }))).rejects.toThrow(
      'cannot encode MP4',
    );
  });
});
