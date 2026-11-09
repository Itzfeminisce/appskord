import { WebMOutputFormat } from 'mediabunny';
import { createMuxed } from '@appskord/media/mux';
import type { Muxed, MuxAudio } from './video';

/** VP9 in WebM through mediabunny, with Opus sound; `alpha` keeps the see-through channel. */
export function webmMuxer(width: number, height: number, fps: number, alpha: boolean, audio?: MuxAudio): Muxed {
  return createMuxed({
    format: new WebMOutputFormat(), mime: 'video/webm', video: 'vp9', width, height, fps, alpha,
    audio: audio && { codec: 'opus', sampleRate: audio.sampleRate, channels: audio.channels },
  });
}
