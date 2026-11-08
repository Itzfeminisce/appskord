import type { EncodedPacket } from 'mediabunny';
import {
  DecoderStalled,
  FrameCache,
  cacheCapacity,
  packetReader,
  softwareConfig,
  webCodecsDecoder,
  type FramesOpenOptions,
  type FramesRequest,
  type FramesResponse,
} from './frames';
import { openSource, type OpenedSource } from './source';

let source: OpenedSource | null = null;
let cache: FrameCache<VideoFrame, EncodedPacket> | null = null;
let decoderConfig: VideoDecoderConfig | null = null;
let options: FramesOpenOptions = {};
let busy = false;
let waiting: { id: number; t: number } | null = null;

const reply = (message: FramesResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function buildCache(): void {
  cache?.close();
  cache = null;
  const track = source?.videoTrack;
  if (!track || !decoderConfig) return;
  const config = options.software ? softwareConfig(decoderConfig) : decoderConfig;
  cache = new FrameCache<VideoFrame, EncodedPacket>({
    reader: packetReader(track),
    capacity: options.capacity ?? cacheCapacity((navigator as Navigator & { deviceMemory?: number }).deviceMemory),
    // A failed decoder is closed for good, so the next request starts on a fresh one.
    createDecoder: (onFrame) => webCodecsDecoder(config, onFrame, () => queueMicrotask(buildCache)),
  });
}

async function open(id: number, blob: Blob, openOptions: FramesOpenOptions = {}): Promise<void> {
  cache?.close();
  source?.dispose();
  cache = null;
  // Intel hardware decode gave green frames and shares a small buffer pool, so decode in software unless told not to.
  options = { ...openOptions, software: openOptions.software ?? true };
  try {
    source = await openSource(blob);
    decoderConfig = (await source.videoTrack?.getDecoderConfig()) ?? null;
    buildCache();
    reply({ type: 'opened', id, info: { duration: source.duration, video: source.video, audio: source.audio } });
  } catch (error) {
    reply({ type: 'error', id, message: describe(error) });
  }
}

async function frameAt(t: number): Promise<VideoFrame | null> {
  if (!cache) return null;
  try {
    return await cache.frameAt(t);
  } catch (error) {
    if (!(error instanceof DecoderStalled) || options.software) throw error;
    console.error('Video decoder stalled; switching to software decoding', error);
    options = { ...options, software: true };
    buildCache();
    return cache ? cache.frameAt(t) : null;
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
    const found = await frameAt(t);
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
  if (request.type === 'open') void open(request.id, request.blob, request.options);
  else if (request.type === 'frame') void frame(request.id, request.t);
  else {
    cache?.close();
    source?.dispose();
    cache = null;
    source = null;
  }
});
