import { EncodedPacketSink, type EncodedPacket, type InputVideoTrack } from 'mediabunny';
import type { AudioTrackInfo, VideoTrackInfo } from './source';

/** A decoded frame. VideoFrame fits; timestamps and durations are microseconds. */
export interface CacheFrame {
  readonly timestamp: number;
  readonly duration: number | null;
  close(): void;
}

/** An encoded packet. Timestamps and durations are seconds. */
export interface Packet {
  readonly timestamp: number;
  readonly duration: number;
  readonly type: 'key' | 'delta';
}

export interface PacketReader<P extends Packet> {
  /** The last key packet at or before `t` seconds. */
  keyPacket(t: number): Promise<P | null>;
  /** The first key packet of the track, for a `t` before it. */
  firstKeyPacket(): Promise<P | null>;
  nextPacket(packet: P): Promise<P | null>;
}

export interface FrameDecoder<P extends Packet> {
  /** Resolves once the decoder has taken the packet. */
  decode(packet: P): Promise<void>;
  /** Emits every pending frame; the next packet must be a key packet. */
  flush(): Promise<void>;
  /** Drops pending work; the next packet must be a key packet. */
  reset(): void;
  close(): void;
}

/** Where the decoder stands, in seconds: the last packet fed and the last frame out (null before any). */
export interface DecodePosition {
  fed: number;
  out: number | null;
}

/**
 * Keep decoding forward when no key packet lies between the decoder and the target, and the target frame is still
 * ahead of the decoder's output; otherwise restart at the target's key packet.
 */
export function seekPlan(target: number, key: number, position: DecodePosition | null): 'continue' | 'seek' {
  if (!position) return 'seek';
  if (key > position.fed) return 'seek';
  if (position.out !== null && target <= position.out) return 'seek';
  return 'continue';
}

/** Frames to keep, from `navigator.deviceMemory` in GB (Chrome reports 0.25 to 8). */
export function cacheCapacity(deviceMemory: number | undefined): number {
  if (!deviceMemory || !Number.isFinite(deviceMemory)) return 8;
  return Math.min(16, Math.max(4, Math.round(deviceMemory * 2)));
}

interface Entry<F> {
  frame: F;
  /** Microseconds; unknown until the next frame arrives or the stream ends. */
  end: number | undefined;
}

export interface FrameCacheOptions<F extends CacheFrame, P extends Packet> {
  reader: PacketReader<P>;
  createDecoder(onFrame: (frame: F) => void): FrameDecoder<P>;
  capacity: number;
  /** Packets fed past the target before giving up on a frame that never covers it. */
  maxLead?: number;
}

/** Decoded frames around the playhead. Every frame it drops or replaces is closed. */
export class FrameCache<F extends CacheFrame, P extends Packet> {
  private readonly entries = new Map<number, Entry<F>>();
  private readonly reader: PacketReader<P>;
  private readonly decoder: FrameDecoder<P>;
  private readonly capacity: number;
  private readonly maxLead: number;
  private fed: P | null = null;
  private lastOut: Entry<F> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(options: FrameCacheOptions<F, P>) {
    this.reader = options.reader;
    this.capacity = Math.max(2, options.capacity);
    this.maxLead = options.maxLead ?? 30;
    this.decoder = options.createDecoder((frame) => this.receive(frame));
  }

  get size(): number {
    return this.entries.size;
  }

  /** The frame shown at `t` seconds. The cache owns it: clone it to keep it past the next call. */
  frameAt(t: number): Promise<F | null> {
    const run = this.queue.then(() => this.find(t));
    this.queue = run.catch(() => undefined);
    return run;
  }

  close(): void {
    this.closed = true;
    this.decoder.close();
    for (const entry of this.entries.values()) entry.frame.close();
    this.entries.clear();
    this.lastOut = null;
  }

  private async find(t: number): Promise<F | null> {
    const at = Math.round(t * 1e6);
    const hit = this.lookup(at);
    if (hit || this.closed) return hit;

    const key = (await this.reader.keyPacket(Math.max(0, t))) ?? (await this.reader.firstKeyPacket());
    if (!key) return null;
    const position = this.fed
      ? { fed: this.fed.timestamp, out: this.lastOut ? this.lastOut.frame.timestamp / 1e6 : null }
      : null;
    let next: P | null;
    if (seekPlan(t, key.timestamp, position) === 'seek') {
      this.decoder.reset();
      this.lastOut = null;
      next = key;
    } else {
      next = await this.reader.nextPacket(this.fed as P);
    }

    let lead = 0;
    for (;;) {
      if (this.closed) return null;
      const found = this.lookup(at);
      if (found) return found;
      if (this.lastOut && this.lastOut.frame.timestamp > at) return this.nearest(at);
      if (!next || lead > this.maxLead) {
        await this.decoder.flush();
        if (!next && this.lastOut) this.lastOut.end = Number.POSITIVE_INFINITY;
        this.fed = null;
        return this.lookup(at) ?? this.nearest(at);
      }
      await this.decoder.decode(next);
      this.fed = next;
      if (next.timestamp > t) lead++;
      next = await this.reader.nextPacket(next);
    }
  }

  private receive(frame: F): void {
    if (this.closed) {
      frame.close();
      return;
    }
    if (this.lastOut && this.lastOut.end === undefined) this.lastOut.end = frame.timestamp;
    const existing = this.entries.get(frame.timestamp);
    let entry: Entry<F>;
    if (existing) {
      frame.close();
      entry = existing;
      this.entries.delete(frame.timestamp);
    } else {
      entry = { frame, end: frame.duration ? frame.timestamp + frame.duration : undefined };
    }
    this.entries.set(frame.timestamp, entry);
    this.lastOut = entry;
    this.evict();
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;
      const entry = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      entry?.frame.close();
    }
  }

  private lookup(at: number): F | null {
    for (const [timestamp, entry] of this.entries) {
      if (timestamp <= at && entry.end !== undefined && at < entry.end) return this.touch(timestamp, entry);
    }
    return null;
  }

  /** Best effort when no frame covers `at`, such as a gap in the recording: the latest frame before it. */
  private nearest(at: number): F | null {
    let best: [number, Entry<F>] | null = null;
    for (const [timestamp, entry] of this.entries) {
      if (timestamp <= at && (!best || timestamp > best[0])) best = [timestamp, entry];
    }
    return best ? this.touch(best[0], best[1]) : null;
  }

  private touch(timestamp: number, entry: Entry<F>): F {
    this.entries.delete(timestamp);
    this.entries.set(timestamp, entry);
    return entry.frame;
  }
}

/** Key and next packets of a video track, through Mediabunny. */
export function packetReader(track: InputVideoTrack): PacketReader<EncodedPacket> {
  const sink = new EncodedPacketSink(track);
  return {
    keyPacket: (t) => sink.getKeyPacket(t, { verifyKeyPackets: true }),
    firstKeyPacket: () => sink.getFirstKeyPacket({ verifyKeyPackets: true }),
    nextPacket: (packet) => sink.getNextPacket(packet),
  };
}

/** A WebCodecs VideoDecoder behind the FrameDecoder seam. */
export function webCodecsDecoder(
  config: VideoDecoderConfig,
  onFrame: (frame: VideoFrame) => void,
  onError: (error: DOMException) => void,
): FrameDecoder<EncodedPacket> {
  let fail: ((error: DOMException) => void) | null = null;
  const decoder = new VideoDecoder({
    output: onFrame,
    error(error) {
      fail?.(error);
      onError(error);
    },
  });
  decoder.configure(config);
  return {
    async decode(packet) {
      decoder.decode(packet.toEncodedVideoChunk());
      // Waiting for the decoder to take each packet lets its frames arrive before we feed more.
      if (decoder.decodeQueueSize > 0) {
        await new Promise((resolve, reject) => {
          fail = reject;
          decoder.addEventListener('dequeue', resolve, { once: true });
        });
        fail = null;
      }
    },
    flush: () => decoder.flush(),
    reset() {
      decoder.reset();
      decoder.configure(config);
    },
    close() {
      if (decoder.state !== 'closed') decoder.close();
    },
  };
}

export interface SourceInfo {
  duration: number;
  video: VideoTrackInfo | null;
  audio: AudioTrackInfo | null;
}

export type FramesRequest =
  | { type: 'open'; id: number; blob: Blob }
  | { type: 'frame'; id: number; t: number }
  | { type: 'close' };

export type FramesResponse =
  | { type: 'opened'; id: number; info: SourceInfo }
  | { type: 'frame'; id: number; frame: VideoFrame | null }
  | { type: 'error'; id: number; message: string };

export interface FramesClient {
  open(blob: Blob): Promise<SourceInfo>;
  /** The frame at `t` seconds, or null when a newer request replaced this one. The caller closes it. */
  frameAt(t: number): Promise<VideoFrame | null>;
  close(): void;
}

/** Talks to a frames worker (`@appskord/media/frames.worker`) from a page. */
export function framesClient(worker: Worker): FramesClient {
  let nextId = 1;
  const pending = new Map<number, { resolve(value: never): void; reject(error: Error): void }>();
  worker.addEventListener('message', (event: MessageEvent<FramesResponse>) => {
    const message = event.data;
    const waiter = pending.get(message.id);
    if (!waiter) {
      if (message.type === 'frame') message.frame?.close();
      return;
    }
    pending.delete(message.id);
    if (message.type === 'error') waiter.reject(new Error(message.message));
    else waiter.resolve((message.type === 'opened' ? message.info : message.frame) as never);
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    const error = new Error(event.message || 'Frames worker failed');
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  const ask = <T>(request: FramesRequest & { id: number }): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.set(request.id, { resolve: resolve as (value: never) => void, reject });
      worker.postMessage(request);
    });
  return {
    open: (blob) => ask<SourceInfo>({ type: 'open', id: nextId++, blob }),
    frameAt: (t) => ask<VideoFrame | null>({ type: 'frame', id: nextId++, t }),
    close() {
      worker.postMessage({ type: 'close' } satisfies FramesRequest);
      for (const waiter of pending.values()) waiter.reject(new Error('Frames worker closed'));
      pending.clear();
      worker.terminate();
    },
  };
}
