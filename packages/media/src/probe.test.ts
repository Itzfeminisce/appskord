import { describe, expect, it } from 'vitest';
import { avcCodecFor, probeEncoder, type ProbeDeps } from './probe';

describe('avcCodecFor', () => {
  it('picks the lowest H.264 level for the size', () => {
    expect(avcCodecFor(1280, 720)).toBe('avc1.64001f');
    expect(avcCodecFor(1920, 1080)).toBe('avc1.640028');
    expect(avcCodecFor(2560, 1440)).toBe('avc1.640032');
  });
});

function fakes(hardware: boolean, software: boolean, msPerFrame: number) {
  let clock = 0;
  const frames: { closed: boolean }[] = [];
  const deps: ProbeDeps = {
    async isConfigSupported(config) {
      return { supported: config.hardwareAcceleration === 'prefer-hardware' ? hardware : software, config };
    },
    createEncoder: () => ({
      encode: () => {
        clock += msPerFrame;
      },
      flush: async () => undefined,
      close: () => undefined,
    }),
    makeFrame() {
      const frame = { closed: false, close: () => (frame.closed = true) };
      frames.push(frame);
      return frame as unknown as VideoFrame;
    },
    now: () => clock,
    frames: 10,
  };
  return { deps, frames };
}

describe('probeEncoder', () => {
  it('reports hardware H.264 and the measured speed', async () => {
    const { deps, frames } = fakes(true, true, 20);
    expect(await probeEncoder(1920, 1080, deps)).toEqual({ hardwareH264: true, codec: 'avc1.640028', fps: 50 });
    expect(frames.every((f) => f.closed)).toBe(true);
  });

  it('measures the software encoder when no hardware one fits', async () => {
    const { deps } = fakes(false, true, 100);
    expect(await probeEncoder(1280, 720, deps)).toMatchObject({ hardwareH264: false, fps: 10 });
  });

  it('reports 0 fps when H.264 cannot be encoded', async () => {
    const { deps, frames } = fakes(false, false, 1);
    expect(await probeEncoder(1280, 720, deps)).toMatchObject({ hardwareH264: false, fps: 0 });
    expect(frames).toHaveLength(0);
  });
});
