import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Output,
  StreamTarget,
  type AudioCodec,
  type OutputFormat,
  type VideoCodec,
} from 'mediabunny';
import { blobSink } from './blobSink';

/** A container being filled from WebCodecs chunks; `finish` returns the file. */
export interface Muxed {
  mime: string;
  addVideo(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudio(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finish(): Promise<Blob>;
  /** Abandons the file: no more chunks are taken and nothing is written. */
  cancel(): Promise<void>;
}

export interface MuxSetup {
  format: OutputFormat;
  mime: string;
  video: VideoCodec;
  width: number;
  height: number;
  fps: number;
  alpha?: boolean;
  audio?: { codec: AudioCodec; sampleRate: number; channels: number };
}

/** A mediabunny output that streams its bytes into Blob parts; chunks are added in order and awaited behind the scenes. */
export function createMuxed(s: MuxSetup): Muxed {
  const sink = blobSink();
  const output = new Output({ format: s.format, target: new StreamTarget(sink.writable, { chunked: true }) });
  const video = new EncodedVideoPacketSource(s.video);
  output.addVideoTrack(video, { frameRate: s.fps, ...(s.alpha ? { canBeTransparent: true } : {}) });
  const audio = s.audio ? new EncodedAudioPacketSource(s.audio.codec) : null;
  if (audio) output.addAudioTrack(audio);
  let failure: unknown = null;
  // One chain per track: mediabunny holds a track that runs ahead (sound is added first) until the other catches up.
  const started = output.start().catch((e) => {
    failure ??= e;
  });
  const chains = { video: started, audio: started };
  const queue = (track: 'video' | 'audio', add: () => Promise<void>) => {
    if (failure) throw failure;
    chains[track] = chains[track].then(add).catch((e) => {
      failure ??= e;
    });
  };
  return {
    mime: s.mime,
    addVideo: (chunk, meta) =>
      queue('video', () => {
        // Chrome hands the see-through channel over as alphaSideData, which the DOM types lack.
        const alpha = (meta as { alphaSideData?: Uint8Array } | undefined)?.alphaSideData;
        return video.add(EncodedPacket.fromEncodedChunk(chunk, alpha ? { alpha } : undefined), meta);
      }),
    addAudio: (chunk, meta) => queue('audio', () => audio!.add(EncodedPacket.fromEncodedChunk(chunk), meta)),
    async finish() {
      await Promise.all([chains.video, chains.audio]);
      if (failure) throw failure;
      await output.finalize();
      return sink.blob(s.mime);
    },
    async cancel() {
      failure ??= new Error('Muxing cancelled');
      await started;
      if (output.state === 'started') await output.cancel();
    },
  };
}
