import {
  AudioSampleSource,
  BufferTarget,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
  VideoSampleSource,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';

export type Container = 'mp4' | 'webm';
export type WriterVideoCodec = 'avc' | 'vp9' | 'vp8';
export type WriterAudioCodec = 'aac' | 'opus';

export interface CodecSupport {
  avc: boolean;
  vp9: boolean;
  vp8: boolean;
  aac: boolean;
  opus: boolean;
}

export interface WriterCodecs {
  video: WriterVideoCodec;
  /** Null when the export has no audio. */
  audio: WriterAudioCodec | null;
}

/** MP4 is H.264 with AAC, else Opus. WebM is VP9, else VP8, with Opus. Null when the container cannot be written. */
export function chooseCodecs(container: Container, support: CodecSupport, withAudio: boolean): WriterCodecs | null {
  const video: WriterVideoCodec | null =
    container === 'mp4' ? (support.avc ? 'avc' : null) : support.vp9 ? 'vp9' : support.vp8 ? 'vp8' : null;
  if (!video) return null;
  if (!withAudio) return { video, audio: null };
  const audio: WriterAudioCodec | null = container === 'mp4' && support.aac ? 'aac' : support.opus ? 'opus' : null;
  return audio ? { video, audio } : null;
}

export interface WriterAudio {
  sampleRate: number;
  channels: number;
  /** Bits per second. */
  bitrate?: number;
}

export interface WriterOptions {
  container: Container;
  /** Every frame added must already be this size: frames go to the encoder without a resize copy. */
  width: number;
  height: number;
  fps: number;
  /** Video bits per second. */
  bitrate: number;
  /** False for an export without sound. */
  audio: WriterAudio | false;
  /** Use the hardware encoder; set it from probeEncoder. */
  hardware?: boolean;
  /** Write as it goes, for long exports; otherwise the file is kept in memory and finish() returns it. */
  stream?: WritableStream<StreamTargetChunk>;
}

export interface Writer {
  codecs: WriterCodecs;
  mimeType: string;
  video: VideoSampleSource;
  audio: AudioSampleSource | null;
  start(): Promise<void>;
  /** The finished file, or null when it was written to `stream`. */
  finish(): Promise<Blob | null>;
  cancel(): Promise<void>;
}

export interface EncodeSupport {
  canEncodeVideo: typeof canEncodeVideo;
  canEncodeAudio: typeof canEncodeAudio;
}

const AUDIO_BITRATE = 128_000;

export async function probeCodecs(options: WriterOptions, deps: EncodeSupport): Promise<CodecSupport> {
  const video = { width: options.width, height: options.height, bitrate: options.bitrate, frameRate: options.fps };
  const audio = options.audio
    ? {
        sampleRate: options.audio.sampleRate,
        numberOfChannels: options.audio.channels,
        bitrate: options.audio.bitrate ?? AUDIO_BITRATE,
      }
    : undefined;
  const mp4 = options.container === 'mp4';
  const [avc, vp9, vp8, aac, opus] = await Promise.all([
    mp4 ? deps.canEncodeVideo('avc', video) : false,
    mp4 ? false : deps.canEncodeVideo('vp9', video),
    mp4 ? false : deps.canEncodeVideo('vp8', video),
    mp4 && audio ? deps.canEncodeAudio('aac', audio) : false,
    audio ? deps.canEncodeAudio('opus', audio) : false,
  ]);
  return { avc, vp9, vp8, aac, opus };
}

export async function createWriter(
  options: WriterOptions,
  deps: EncodeSupport = { canEncodeVideo, canEncodeAudio },
): Promise<Writer> {
  const codecs = chooseCodecs(options.container, await probeCodecs(options, deps), options.audio !== false);
  if (!codecs) throw new Error(`This browser cannot encode ${options.container.toUpperCase()} at this size.`);

  const target = options.stream ? new StreamTarget(options.stream) : new BufferTarget();
  const format =
    options.container === 'mp4'
      ? new Mp4OutputFormat({ fastStart: options.stream ? 'fragmented' : 'in-memory' })
      : new WebMOutputFormat();
  const output = new Output({ format, target });
  const video = new VideoSampleSource({
    codec: codecs.video,
    bitrate: options.bitrate,
    hardwareAcceleration: options.hardware ? 'prefer-hardware' : 'no-preference',
  });
  output.addVideoTrack(video, { frameRate: options.fps });
  let audio: AudioSampleSource | null = null;
  if (codecs.audio && options.audio) {
    audio = new AudioSampleSource({ codec: codecs.audio, bitrate: options.audio.bitrate ?? AUDIO_BITRATE });
    output.addAudioTrack(audio);
  }
  const mimeType = options.container === 'mp4' ? 'video/mp4' : 'video/webm';

  return {
    codecs,
    mimeType,
    video,
    audio,
    start: () => output.start(),
    async finish() {
      await output.finalize();
      return target instanceof BufferTarget && target.buffer ? new Blob([target.buffer], { type: mimeType }) : null;
    },
    cancel: () => output.cancel(),
  };
}
