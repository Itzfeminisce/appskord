import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DECODE_STALL_MS,
  DecoderStalled,
  FrameCache,
  cacheCapacity,
  seekPlan,
  stallGuard,
  type FrameDecoder,
  type Packet,
} from './frames';

const FPS = 30;
const GOP = 10;

class FakeFrame {
  closed = false;
  constructor(
    readonly timestamp: number,
    readonly duration: number | null,
  ) {}
  close() {
    this.closed = true;
  }
}

const packets: Packet[] = Array.from({ length: 60 }, (_, i) => ({
  timestamp: i / FPS,
  duration: 1 / FPS,
  type: i % GOP === 0 ? 'key' : 'delta',
}));

const reader = {
  async keyPacket(t: number) {
    return [...packets].reverse().find((p) => p.type === 'key' && p.timestamp <= t + 1e-9) ?? null;
  },
  async firstKeyPacket() {
    return packets.find((p) => p.type === 'key') ?? null;
  },
  async nextPacket(p: Packet) {
    return packets[packets.indexOf(p) + 1] ?? null;
  },
};

function setup(options: { capacity?: number; withDuration?: boolean; lag?: number; reader?: typeof reader } = {}) {
  const { capacity = 8, withDuration = true, lag = 0, reader: source = reader } = options;
  const made: FakeFrame[] = [];
  const log: { reset: number; fed: number[] } = { reset: 0, fed: [] };
  let held: Packet[] = [];
  let needKey = true;
  const cache = new FrameCache<FakeFrame, Packet>({
    reader: source,
    capacity,
    createDecoder(onFrame): FrameDecoder<Packet> {
      const emit = (p: Packet) => {
        const frame = new FakeFrame(Math.round(p.timestamp * 1e6), withDuration ? Math.round(p.duration * 1e6) : null);
        made.push(frame);
        onFrame(frame);
      };
      return {
        async decode(p) {
          if (needKey && p.type !== 'key') throw new Error('key packet required');
          needKey = false;
          log.fed.push(packets.indexOf(p));
          held.push(p);
          while (held.length > lag) emit(held.shift() as Packet);
        },
        async flush() {
          held.splice(0).forEach(emit);
          needKey = true;
        },
        reset() {
          held = [];
          needKey = true;
          log.reset++;
        },
        close() {},
      };
    },
  });
  return { cache, made, log };
}

const frameIndex = (f: FakeFrame | null) => (f ? Math.round((f.timestamp / 1e6) * FPS) : null);

describe('seekPlan', () => {
  it('seeks when the decoder has not started', () => {
    expect(seekPlan(1, 0.9, null)).toBe('seek');
  });
  it('continues forward when no key packet lies between decoder and target', () => {
    expect(seekPlan(0.3, 0, { fed: 0.2, out: 0.2 })).toBe('continue');
  });
  it('seeks to a key packet ahead of the decoder', () => {
    expect(seekPlan(0.5, 0.33, { fed: 0.2, out: 0.2 })).toBe('seek');
  });
  it('seeks when the target is behind the decoder output', () => {
    expect(seekPlan(0.1, 0, { fed: 0.2, out: 0.2 })).toBe('seek');
  });
});

describe('FrameCache', () => {
  it('decodes from the nearest key packet on a jump', async () => {
    const { cache, log } = setup();
    expect(frameIndex(await cache.frameAt(45 / FPS + 0.001))).toBe(45);
    expect(log.fed[0]).toBe(40);
    expect(log.fed.at(-1)).toBe(45);
  });

  it('keeps decoding forward inside a group of pictures without a reset', async () => {
    const { cache, log } = setup();
    await cache.frameAt(3 / FPS);
    const resets = log.reset;
    expect(frameIndex(await cache.frameAt(7 / FPS))).toBe(7);
    expect(log.reset).toBe(resets);
    expect(log.fed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('jumps to a later key packet instead of decoding through', async () => {
    const { cache, log } = setup();
    await cache.frameAt(3 / FPS);
    expect(frameIndex(await cache.frameAt(25 / FPS))).toBe(25);
    expect(log.fed.slice(4)).toEqual([20, 21, 22, 23, 24, 25]);
  });

  it('falls back to the first key packet when t precedes it', async () => {
    const { cache } = setup({ reader: { ...reader, keyPacket: async () => null } });
    expect(frameIndex(await cache.frameAt(0))).toBe(0);
  });

  it('serves a cached frame without decoding', async () => {
    const { cache, log } = setup();
    await cache.frameAt(5 / FPS);
    const fed = log.fed.length;
    expect(frameIndex(await cache.frameAt(4 / FPS))).toBe(4);
    expect(log.fed.length).toBe(fed);
  });

  it('keeps at most capacity frames and closes every frame it drops', async () => {
    const { cache, made } = setup({ capacity: 4 });
    for (let i = 0; i < 60; i += 3) await cache.frameAt(i / FPS);
    expect(cache.size).toBeLessThanOrEqual(4);
    const open = made.filter((f) => !f.closed);
    expect(open.length).toBe(cache.size);
    cache.close();
    expect(made.every((f) => f.closed)).toBe(true);
  });

  it('closes a duplicate frame decoded again after a seek', async () => {
    const { cache, made } = setup();
    await cache.frameAt(25 / FPS);
    await cache.frameAt(5 / FPS);
    await cache.frameAt(25 / FPS + 0.5 / FPS);
    const open = made.filter((f) => !f.closed).map((f) => f.timestamp);
    expect(new Set(open).size).toBe(open.length);
  });

  it('finds frames without durations when the decoder lags behind', async () => {
    const { cache } = setup({ withDuration: false, lag: 3 });
    expect(frameIndex(await cache.frameAt(12 / FPS + 0.01))).toBe(12);
    expect(frameIndex(await cache.frameAt(14 / FPS))).toBe(14);
  });

  it('returns the last frame past the end', async () => {
    const { cache } = setup({ withDuration: false });
    expect(frameIndex(await cache.frameAt(5))).toBe(59);
  });
});

describe('cacheCapacity', () => {
  it('keeps few frames open, fewer on low-memory devices', () => {
    expect(cacheCapacity(undefined)).toBe(4);
    expect(cacheCapacity(0.5)).toBe(2);
    expect(cacheCapacity(2)).toBe(2);
    expect(cacheCapacity(4)).toBe(4);
    expect(cacheCapacity(8)).toBe(4);
  });
});

/** A hardware-like decoder with a pool of `pool` output buffers: it stops emitting while that many frames are open. */
function stallingSetup(pool: number) {
  const made: FakeFrame[] = [];
  let resets = 0;
  const cache = new FrameCache<FakeFrame, Packet>({
    reader,
    capacity: 8,
    createDecoder(onFrame): FrameDecoder<Packet> {
      return {
        async decode(p) {
          if (made.filter((f) => !f.closed).length >= pool) return stallGuard(new Promise<void>(() => {}));
          const frame = new FakeFrame(Math.round(p.timestamp * 1e6), Math.round(p.duration * 1e6));
          made.push(frame);
          onFrame(frame);
        },
        flush: async () => {},
        reset() {
          resets++;
        },
        close() {},
      };
    },
  });
  return { cache, made, resets: () => resets };
}

describe('decoder stall', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a wait that outlasts the stall timeout', async () => {
    vi.useFakeTimers();
    const guarded = stallGuard(new Promise<void>(() => {}));
    const caught = guarded.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(DECODE_STALL_MS);
    expect(await caught).toBeInstanceOf(DecoderStalled);
  });

  it('recovers: rejects with the stall, closes its frames, and the next request works', async () => {
    vi.useFakeTimers();
    const { cache, made, resets } = stallingSetup(5);
    const stalled = cache.frameAt(9 / FPS + 0.001).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(DECODE_STALL_MS);
    expect(await stalled).toBeInstanceOf(DecoderStalled);
    expect(made.length).toBe(5);
    expect(made.every((f) => f.closed)).toBe(true);
    expect(cache.size).toBe(0);
    expect(resets()).toBeGreaterThan(0);
    expect(frameIndex(await cache.frameAt(2 / FPS + 0.001))).toBe(2);
  });
});
