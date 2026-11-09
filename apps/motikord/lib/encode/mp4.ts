import { Mp4OutputFormat } from 'mediabunny';
import { createMuxed } from '@appskord/media/mux';
import type { Muxed, MuxAudio } from './video';

/** H.264 in MP4 through mediabunny; audio is AAC, or Opus in MP4 where Chrome has no AAC encoder. */
export function mp4Muxer(width: number, height: number, fps: number, audio?: MuxAudio): Muxed {
  return createMuxed({
    format: new Mp4OutputFormat({ fastStart: false }), mime: 'video/mp4', video: 'avc', width, height, fps,
    audio: audio && { codec: audio.codec === 'aac' ? 'aac' : 'opus', sampleRate: audio.sampleRate, channels: audio.channels },
  });
}
