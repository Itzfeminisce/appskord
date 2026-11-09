import { describe, expect, it } from 'vitest';
import { blobSink } from './blobSink';

const bytes = async (b: Blob) => [...new Uint8Array(await b.arrayBuffer())];

describe('blobSink', () => {
  it('appends sequential writes and splices patches over earlier bytes', async () => {
    const sink = blobSink();
    const w = sink.writable.getWriter();
    await w.write({ type: 'write', data: new Uint8Array([1, 2, 3, 4]), position: 0 });
    await w.write({ type: 'write', data: new Uint8Array([5, 6]), position: 4 });
    await w.write({ type: 'write', data: new Uint8Array([9, 9]), position: 1 });
    await w.write({ type: 'write', data: new Uint8Array([8, 8, 8]), position: 3 });
    await w.close();
    const blob = sink.blob('video/mp4');
    expect(blob.type).toBe('video/mp4');
    expect(await bytes(blob)).toEqual([1, 9, 9, 8, 8, 8]);
  });
});
