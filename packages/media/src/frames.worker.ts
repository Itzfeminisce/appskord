import type { EncodedPacket } from 'mediabunny';
import { FrameCache, cacheCapacity, packetReader, webCodecsDecoder, type FramesRequest, type FramesResponse } from './frames';
import { openSource, type OpenedSource } from './source';

let source: OpenedSource | null = null;
let cache: FrameCache<VideoFrame, EncodedPacket> | null = null;
let decoderConfig: VideoDecoderConfig | null = null;
let busy = false;
let waiting: { id: number; t: number } | null = null;

const reply = (message: FramesResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function buildCache(): void {
  cache?.close();
  cache = null;
  const track = source?.videoTrack;
  if (!track || !decoderConfig) return;
  const config = decoderConfig;
  cache = new FrameCache<VideoFrame, EncodedPacket>({
    reader: packetReader(track),
    capacity: cacheCapacity((navigator as Navigator & { deviceMemory?: number }).deviceMemory),
    // A failed decoder is closed for good, so the next request starts on a fresh one.
    createDecoder: (onFrame) => webCodecsDecoder(config, onFrame, () => queueMicrotask(buildCache)),
  });
}

async function open(id: number, blob: Blob): Promise<void> {
  cache?.close();
  source?.dispose();
  cache = null;
  try {
    source = await openSource(blob);
    decoderConfig = (await source.videoTrack?.getDecoderConfig()) ?? null;
    buildCache();
    reply({ type: 'opened', id, info: { duration: source.duration, video: source.video, audio: source.audio } });
  } catch (error) {
    reply({ type: 'error', id, message: describe(error) });
  }
}

// Only the newest request matters while scrubbing; older ones get null.
async function frame(id: number, t: number): Promise<void> {
  if (busy) {
    if (waiting) reply({ type: 'frame', id: waiting.id, frame: null });
    waiting = { id, t };
    return;
  }
  busy = true;
  try {
    const found = cache ? await cache.frameAt(t) : null;
    const copy = found ? found.clone() : null;
    reply({ type: 'frame', id, frame: copy }, copy ? [copy] : []);
  } catch (error) {
    reply({ type: 'error', id, message: describe(error) });
  } finally {
    busy = false;
    const next = waiting;
    waiting = null;
    if (next) void frame(next.id, next.t);
  }
}

self.addEventListener('message', (event: MessageEvent<FramesRequest>) => {
  const request = event.data;
  if (request.type === 'open') void open(request.id, request.blob);
  else if (request.type === 'frame') void frame(request.id, request.t);
  else {
    cache?.close();
    source?.dispose();
    cache = null;
    source = null;
  }
});
