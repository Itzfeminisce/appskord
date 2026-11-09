import { createMuxed } from '@appskord/media/mux';
import { beforeAll, expect, it, vi } from 'vitest';
import { mp4Format } from './index';

class FakeChunk {
  byteLength = 32;
  constructor(readonly type: string, readonly timestamp: number, readonly duration: number) {}
  copyTo(d: Uint8Array) { d.fill(1); }
}
beforeAll(() => vi.stubGlobal('EncodedVideoChunk', FakeChunk));
const avcC = new Uint8Array([1, 0x42, 0xc0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xc0, 0x1f, 1, 0, 2, 0x68, 0xce]);

function boxes(b: Uint8Array): string[] {
  const out: string[] = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let at = 0; at + 8 <= b.length;) {
    out.push(String.fromCharCode(...b.subarray(at + 4, at + 8)));
    const size = v.getUint32(at);
    if (size < 8) break;
    at += size;
  }
  return out;
}

it('Klipkord MP4 output puts moov before mdat', async () => {
  const mux = createMuxed({ format: mp4Format(), mime: 'video/mp4', video: 'avc', width: 64, height: 64, fps: 30 });
  for (let i = 0; i < 5; i++) {
    const meta = i === 0 ? ({ decoderConfig: { codec: 'avc1.42c01f', codedWidth: 64, codedHeight: 64, description: avcC } } as EncodedVideoChunkMetadata) : undefined;
    mux.addVideo(new FakeChunk(i === 0 ? 'key' : 'delta', i * 33_333, 33_333) as unknown as EncodedVideoChunk, meta);
  }
  const top = boxes(new Uint8Array(await (await mux.finish()).arrayBuffer()));
  expect(top[0]).toBe('ftyp');
  expect(top.indexOf('moov')).toBeGreaterThan(0);
  expect(top.indexOf('moov')).toBeLessThan(top.indexOf('mdat'));
});
