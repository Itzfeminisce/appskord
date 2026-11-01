import {
  ALL_FORMATS,
  AudioSampleSink,
  BlobSource,
  Input,
  VideoSampleSink,
  type AudioSample,
  type InputAudioTrack,
  type InputVideoTrack,
  type VideoSample,
} from 'mediabunny';

export interface VideoTrackInfo {
  codec: string | null;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface AudioTrackInfo {
  codec: string | null;
  sampleRate: number;
  channels: number;
}

export interface OpenedSource {
  /** Seconds. */
  duration: number;
  video: VideoTrackInfo | null;
  audio: AudioTrackInfo | null;
  /** The decoded frame shown at `t` seconds, or null when there is no video. Past the end Mediabunny returns the last frame. The caller closes it. */
  frameAt(t: number): Promise<VideoSample | null>;
  /** Decoded video frames from `from` to `to` seconds, in order. The caller closes each one. */
  samples(from: number, to: number): AsyncGenerator<VideoSample, void, unknown>;
  /** Decoded audio from `from` to `to` seconds, in order. The caller closes each one. */
  audioSamples(from: number, to: number): AsyncGenerator<AudioSample, void, unknown>;
  videoTrack: InputVideoTrack | null;
  audioTrack: InputAudioTrack | null;
  dispose(): void;
}

export async function openSource(blob: Blob): Promise<OpenedSource> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const [videoTrack, audioTrack] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
  const duration = await input.computeDuration();
  const video: VideoTrackInfo | null = videoTrack
    ? {
        codec: await videoTrack.getCodec(),
        width: await videoTrack.getDisplayWidth(),
        height: await videoTrack.getDisplayHeight(),
        rotation: await videoTrack.getRotation(),
      }
    : null;
  const audio: AudioTrackInfo | null = audioTrack
    ? {
        codec: await audioTrack.getCodec(),
        sampleRate: await audioTrack.getSampleRate(),
        channels: await audioTrack.getNumberOfChannels(),
      }
    : null;
  let videoSink: VideoSampleSink | null = null;
  const sink = () => (videoSink ??= videoTrack ? new VideoSampleSink(videoTrack) : null);

  return {
    duration,
    video,
    audio,
    videoTrack,
    audioTrack,
    async frameAt(t) {
      return (await sink()?.getSample(t)) ?? null;
    },
    async *samples(from, to) {
      const s = sink();
      if (s) yield* s.samples(from, to);
    },
    async *audioSamples(from, to) {
      if (audioTrack) yield* new AudioSampleSink(audioTrack).samples(from, to);
    },
    dispose() {
      input.dispose();
    },
  };
}
