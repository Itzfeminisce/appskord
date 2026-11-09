import { Mp4OutputFormat, WebMOutputFormat } from 'mediabunny';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createMuxed } from './mux';

// Node has no WebCodecs; a stand-in class is all fromEncodedChunk needs.
class FakeChunk {
  byteLength = 32;
  constructor(
    readonly type: string,
    readonly timestamp: number,
    readonly duration: number,
    private fill: number,
  ) {}
  copyTo(d: Uint8Array) {
    d.fill(this.fill);
  }
}
beforeAll(() => vi.stubGlobal('EncodedVideoChunk', FakeChunk));
const chunk = (i: number, key: boolean) =>
  new FakeChunk(key ? 'key' : 'delta', i * 33_333, 33_333, i) as unknown as EncodedVideoChunk;
// avcC with one tiny SPS and PPS, enough for the muxer to write a track.
const avcC = new Uint8Array([1, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1f, 1, 0, 2, 0x68, 0xce]);
const meta = (codec: string, description?: Uint8Array) =>
  ({ decoderConfig: { codec, codedWidth: 64, codedHeight: 64, description } }) as EncodedVideoChunkMetadata;

describe('createMuxed', () => {
  it('writes an MP4 whose ftyp box leads and whose moov holds the track', async () => {
    const mux = createMuxed({
      format: new Mp4OutputFormat({ fastStart: false }),
      mime: 'video/mp4',
      video: 'avc',
      width: 64,
      height: 64,
      fps: 30,
    });
    for (let i = 0; i < 5; i++) mux.addVideo(chunk(i, i === 0), i === 0 ? meta('avc1.42c01f', avcC) : undefined);
    const blob = await mux.finish();
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    expect(blob.type).toBe('video/mp4');
    expect(new TextDecoder().decode(head.subarray(4, 8))).toBe('ftyp');
    expect(new TextDecoder().decode(await blob.arrayBuffer(), { stream: false })).toContain('moov');
  });

  it('writes a WebM that starts with the EBML header', async () => {
    const mux = createMuxed({
      format: new WebMOutputFormat(),
      mime: 'video/webm',
      video: 'vp9',
      width: 64,
      height: 64,
      fps: 30,
    });
    for (let i = 0; i < 5; i++) mux.addVideo(chunk(i, i === 0), i === 0 ? meta('vp09.00.10.08') : undefined);
    const blob = await mux.finish();
    expect([...new Uint8Array(await blob.slice(0, 4).arrayBuffer())]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(blob.type).toBe('video/webm');
  });

  it('cancel abandons the file: finish then fails and nothing more is taken', async () => {
    const mux = createMuxed({
      format: new WebMOutputFormat(),
      mime: 'video/webm',
      video: 'vp9',
      width: 64,
      height: 64,
      fps: 30,
    });
    mux.addVideo(chunk(0, true), meta('vp09.00.10.08'));
    await mux.cancel();
    expect(() => mux.addVideo(chunk(1, false))).toThrow(/cancelled/);
    await expect(mux.finish()).rejects.toThrow(/cancelled/);
  });
});
