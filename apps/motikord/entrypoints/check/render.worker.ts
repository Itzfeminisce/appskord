import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { Mp4OutputFormat, WebMOutputFormat } from 'mediabunny';
import { createMuxed } from '@appskord/media/mux';
import { CODECS, exportPlan, type ExportKind } from '@/lib/check/plan';
import { drawFrame, makeImages } from './draw';

export type RenderReply =
  | { type: 'progress'; frame: number; frames: number }
  | { type: 'done'; seconds: number; bytes: number; encoder: string; supported: boolean }
  | { type: 'error'; message: string };

const post = (reply: RenderReply) => self.postMessage(reply);
const MAX_QUEUE = 6;

/** prefer-hardware first, then prefer-software; the first config the browser accepts wins. */
async function pickConfig(base: VideoEncoderConfig): Promise<{ config: VideoEncoderConfig; encoder: string } | null> {
  for (const hardwareAcceleration of ['prefer-hardware', 'prefer-software'] as const) {
    const config = { ...base, hardwareAcceleration };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, encoder: hardwareAcceleration === 'prefer-hardware' ? 'hardware' : 'software' };
    } catch { /* try the next one */ }
  }
  return null;
}

async function video(kind: Exclude<ExportKind, 'gif'>) {
  const plan = exportPlan(kind);
  const seeThrough = kind === 'alpha';
  const picked = await pickConfig({
    codec: kind === 'mp4' ? CODECS.h264 : CODECS.vp9,
    width: plan.width, height: plan.height, framerate: plan.fps, bitrate: 8_000_000,
    ...(kind === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
    ...(seeThrough ? { alpha: 'keep' as const } : {}),
  });
  if (!picked) return post({ type: 'done', seconds: 0, bytes: 0, encoder: 'none', supported: false });

  const mux = kind === 'mp4'
    ? createMuxed({ format: new Mp4OutputFormat({ fastStart: false }), mime: 'video/mp4', video: 'avc', width: plan.width, height: plan.height, fps: plan.fps })
    : createMuxed({ format: new WebMOutputFormat(), mime: 'video/webm', video: 'vp9', width: plan.width, height: plan.height, fps: plan.fps, alpha: seeThrough });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { try { mux.addVideo(chunk, meta); } catch (e) { failure ??= e; } },
    error: (e) => { failure ??= e; },
  });
  encoder.configure(picked.config);
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext('2d')!;
  const images = makeImages();
  const start = performance.now();
  for (let i = 0; i < plan.frames; i++) {
    if (failure) throw failure;
    drawFrame(ctx, i / plan.fps, plan.width, plan.height, images, seeThrough);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / plan.fps), duration: Math.round(1e6 / plan.fps) });
    encoder.encode(frame, { keyFrame: i % (plan.fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > MAX_QUEUE) await new Promise((r) => setTimeout(r, 1));
    if (i % 30 === 0) post({ type: 'progress', frame: i + 1, frames: plan.frames });
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  const file = await mux.finish();
  post({ type: 'done', seconds: (performance.now() - start) / 1000, bytes: file.size, encoder: picked.encoder, supported: true });
}

function gif() {
  const plan = exportPlan('gif');
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const images = makeImages();
  const enc = GIFEncoder();
  const start = performance.now();
  for (let i = 0; i < plan.frames; i++) {
    drawFrame(ctx, i / plan.fps, plan.width, plan.height, images);
    const rgba = ctx.getImageData(0, 0, plan.width, plan.height).data;
    const palette = quantize(rgba, 256);
    enc.writeFrame(applyPalette(rgba, palette), plan.width, plan.height, { palette, delay: Math.round(1000 / plan.fps) });
    if (i % 15 === 0) post({ type: 'progress', frame: i + 1, frames: plan.frames });
  }
  enc.finish();
  post({ type: 'done', seconds: (performance.now() - start) / 1000, bytes: enc.bytes().byteLength, encoder: 'gifenc', supported: true });
}

self.onmessage = async (event: MessageEvent<ExportKind>) => {
  try {
    if (event.data === 'gif') gif();
    else await video(event.data);
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
