export interface EncoderProbe {
  /** A hardware H.264 encoder takes this size. */
  hardwareH264: boolean;
  /** The H.264 codec string probed. */
  codec: string;
  /** Frames per second encoded in a short run; 0 when H.264 cannot be encoded at this size. */
  fps: number;
}

export interface ProbeEncoder {
  encode(frame: VideoFrame): void;
  flush(): Promise<void>;
  close(): void;
}

export interface ProbeDeps {
  isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
  createEncoder(config: VideoEncoderConfig): ProbeEncoder;
  makeFrame(index: number, width: number, height: number, fps: number): VideoFrame;
  now(): number;
  /** Frames in the timed run. */
  frames: number;
}

/** H.264 High profile at the lowest level that fits the frame size. */
export function avcCodecFor(width: number, height: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const level = macroblocks <= 3_600 ? '1f' : macroblocks <= 8_192 ? '28' : macroblocks <= 22_080 ? '32' : '33';
  return `avc1.6400${level}`;
}

const PROBE_FPS = 30;

const webCodecs: ProbeDeps = {
  isConfigSupported: (config) => VideoEncoder.isConfigSupported(config),
  createEncoder(config) {
    const encoder = new VideoEncoder({ output: () => undefined, error: () => undefined });
    encoder.configure(config);
    return {
      encode: (frame) => encoder.encode(frame),
      flush: () => encoder.flush(),
      close: () => encoder.state !== 'closed' && encoder.close(),
    };
  },
  makeFrame(index, width, height, fps) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context) {
      // Moving content, so the encoder does real work.
      context.fillStyle = `hsl(${(index * 37) % 360} 70% 50%)`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#fff';
      context.fillRect((index * 24) % width, (index * 12) % height, width / 4, height / 4);
    }
    return new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / fps) });
  },
  now: () => performance.now(),
  frames: 30,
};

/** Hardware H.264 support at `width` x `height`, and how fast the encoder runs there. */
export async function probeEncoder(width: number, height: number, deps: ProbeDeps = webCodecs): Promise<EncoderProbe> {
  const codec = avcCodecFor(width, height);
  const base: VideoEncoderConfig = { codec, width, height, bitrate: 8_000_000, framerate: PROBE_FPS };
  const hardware = { ...base, hardwareAcceleration: 'prefer-hardware' as const };
  const hardwareH264 = (await deps.isConfigSupported(hardware).catch(() => ({ supported: false }))).supported === true;
  const config = hardwareH264 ? hardware : base;
  if (!hardwareH264 && (await deps.isConfigSupported(base).catch(() => ({ supported: false }))).supported !== true) {
    return { hardwareH264, codec, fps: 0 };
  }

  const frames = Array.from({ length: deps.frames }, (_, i) => deps.makeFrame(i, width, height, PROBE_FPS));
  const encoder = deps.createEncoder(config);
  try {
    const started = deps.now();
    for (const frame of frames) {
      encoder.encode(frame);
      frame.close();
    }
    await encoder.flush();
    const seconds = (deps.now() - started) / 1000;
    return { hardwareH264, codec, fps: seconds > 0 ? Math.round(deps.frames / seconds) : Number.POSITIVE_INFINITY };
  } catch {
    return { hardwareH264, codec, fps: 0 };
  } finally {
    for (const frame of frames) frame.close();
    encoder.close();
  }
}
