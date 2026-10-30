import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Muxed, MuxAudio } from './video';

/** H.264 in MP4 through mp4-muxer; audio is AAC, or Opus in MP4 where Chrome has no AAC encoder. */
export function mp4Muxer(width: number, height: number, fps: number, audio?: MuxAudio): Muxed {
  const muxer = new Muxer({
    target: new ArrayBufferTarget(), fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    video: { codec: 'avc', width, height, frameRate: fps },
    ...(audio ? { audio: { codec: audio.codec === 'aac' ? 'aac' : 'opus', sampleRate: audio.sampleRate, numberOfChannels: audio.channels } } : {}),
  });
  return {
    mime: 'video/mp4',
    addVideo: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    addAudio: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    finish() { muxer.finalize(); return muxer.target.buffer; },
  };
}
