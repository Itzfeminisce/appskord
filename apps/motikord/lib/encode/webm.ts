import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import type { Muxed, MuxAudio } from './video';

/** VP9 in WebM through webm-muxer, with Opus sound; `alpha` keeps the see-through channel. */
export function webmMuxer(width: number, height: number, fps: number, alpha: boolean, audio?: MuxAudio): Muxed {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(), firstTimestampBehavior: 'offset',
    video: { codec: 'V_VP9', width, height, frameRate: fps, alpha },
    ...(audio ? { audio: { codec: 'A_OPUS', sampleRate: audio.sampleRate, numberOfChannels: audio.channels } } : {}),
  });
  return {
    mime: 'video/webm',
    addVideo: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    addAudio: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    finish() { muxer.finalize(); return muxer.target.buffer; },
  };
}
