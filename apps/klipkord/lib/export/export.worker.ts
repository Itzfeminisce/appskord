// The export worker: walks output time at a fixed frame rate, draws each RenderPlan with lib/render, and encodes
// with packages/media, writing as it goes. A worker keeps full speed while the tab is in the background.
import {
  DecoderStalled, FrameCache, cacheCapacity, createWriter, openSource, packetReader, softwareConfig, webCodecsDecoder,
  type OpenedSource, type Writer,
} from '@appskord/media';
import geistUrl from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import {
  AudioSample, AudioSampleSource, EncodedPacket, Mp4OutputFormat, Output, StreamTarget, VideoSample, canEncodeAudio,
} from 'mediabunny';
import type { MixChunk } from '../audio/export';
import { cutLength, toOut } from '../project/time';
import { cardAssets, drawCard, type CardAssets } from '../render/layers/card';
import { renderPlan } from '../render/plan';
import { createRenderer, type CameraMask, type DrawCard, type FrameProvider, type Picture, type Renderer } from '../render/renderer';
import type { RenderSource } from '../render/render.worker';
import { exportCameraMasks } from '../render/segment';
import SegmentWorker from '../render/segment.worker?worker';
import type { ExportRequest, ExportResponse, GifJob, Job, StillJob, Target, VideoJob } from './protocol';
import { frameCount, frameSchedule } from './schedule';
import { drawTitle } from './title';

const reply = (message: ExportResponse, transfer: Transferable[] = []) => self.postMessage(message, { transfer });
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

class Cancelled extends Error {}

// Sources stay open between jobs (the thumbnail strip renders many stills).
interface OpenedVideo {
  source: OpenedSource;
  cache: FrameCache<VideoFrame, EncodedPacket>;
  software: boolean;
  failed: boolean;
  make(software: boolean): FrameCache<VideoFrame, EncodedPacket>;
}
const videos = new Map<string, Promise<OpenedVideo | null>>();
const images = new Map<string, Promise<ImageBitmap | null>>();
let fontReady: Promise<void> | null = null;
// Card fonts load on the first export with cards and stay for the next; the hook is this job's.
let cards: CardAssets | null = null;
let jobCards: DrawCard | undefined;
let current: { id: number; cancelled: boolean } | null = null;
let audioWaiter: ((chunk: MixChunk | null) => void) | null = null;

function openVideo(s: RenderSource): Promise<OpenedVideo | null> {
  return openSource(s.blob).then(async (source) => {
    const config = await source.videoTrack?.getDecoderConfig();
    if (!source.videoTrack || !config) {
      source.dispose();
      return null;
    }
    const track = source.videoTrack;
    const onError = (error: DOMException) => {
      video.failed = true;
      console.error('Klipkord: could not decode video', error);
    };
    const make = (software: boolean): FrameCache<VideoFrame, EncodedPacket> => new FrameCache<VideoFrame, EncodedPacket>({
      reader: packetReader(track),
      capacity: cacheCapacity((navigator as Navigator & { deviceMemory?: number }).deviceMemory),
      createDecoder: (onFrame) => webCodecsDecoder(software ? softwareConfig(config) : config, onFrame, onError),
    });
    const video: OpenedVideo = { source, cache: make(false), software: false, failed: false, make };
    return video;
  }, (error: unknown) => {
    console.error('Klipkord: could not open video', error);
    return null;
  });
}

function addSources(sources: RenderSource[]): void {
  for (const s of sources) {
    if (videos.has(s.id) || images.has(s.id)) continue;
    if (s.image) {
      images.set(s.id, createImageBitmap(s.blob).catch((error: unknown) => {
        console.error('Klipkord: could not open image', error);
        return null;
      }));
    } else {
      videos.set(s.id, openVideo(s));
    }
  }
}

// A stalled or failed hardware decoder is closed for good; software decode has no shared pool, so rebuild there once.
function toSoftware(opened: OpenedVideo): void {
  opened.software = true;
  opened.failed = false;
  opened.cache.close();
  opened.cache = opened.make(true);
}

const frames: FrameProvider = {
  async frame(source, t): Promise<Picture | null> {
    const image = images.get(source);
    if (image) return image;
    const opened = await videos.get(source);
    if (!opened) return null;
    const at = Math.max(0, t) / 1000;
    let found: VideoFrame | null;
    try {
      if (opened.failed && !opened.software) toSoftware(opened);
      found = await opened.cache.frameAt(at);
    } catch (error) {
      const decoderError = error instanceof DecoderStalled || error instanceof DOMException || opened.failed;
      if (!decoderError || opened.software) throw error;
      toSoftware(opened);
      found = await opened.cache.frameAt(at);
    }
    // The cache owns its frames; the renderer closes what it is handed.
    return found ? found.clone() : null;
  },
};

function loadFont(): Promise<void> {
  fontReady ??= (async () => {
    try {
      const face = new FontFace('Geist', `url(${geistUrl})`, { weight: '100 900' });
      (self as unknown as { fonts: FontFaceSet }).fonts.add(await face.load());
    } catch (error) {
      console.error('Klipkord: could not load font', error);
    }
  })();
  return fontReady;
}

/** The job's cards drawn with @appskord/scenes, once their fonts and the brand logo are ready. */
async function cardHook(job: Job): Promise<DrawCard | undefined> {
  if (!job.cut.cards.length) return undefined;
  cards ??= cardAssets((self as unknown as { fonts: FontFaceSet }).fonts, self.location.href);
  await Promise.all([cards.fonts(), cards.setBrand(job.brand ?? null)]);
  return drawCard((c) => toOut(job.cut, c.at), cards.brand, cards.cache);
}

async function open(target: Target): Promise<{ stream: FileSystemWritableFileStream; handle: FileSystemFileHandle }> {
  let handle: FileSystemFileHandle;
  if (target.kind === 'handle') handle = target.handle;
  else {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('exports', { create: true });
    handle = await dir.getFileHandle(target.name, { create: true });
  }
  return { stream: await handle.createWritable(), handle };
}

function check(id: number): void {
  if (!current || current.id !== id || current.cancelled) throw new Cancelled();
}

/** "Blur behind you": T11's person masks on every frame; the segmentation worker starts on the first blurred frame. */
function cameraMasks(job: Job): { cameraMask: CameraMask; dispose(): void } | null {
  if (!job.cut.camera.blur.on) return null;
  return exportCameraMasks(() => new SegmentWorker());
}

function setup(job: Job): { canvas: OffscreenCanvas; renderer: Renderer } {
  addSources(job.sources);
  const canvas = new OffscreenCanvas(job.width, job.height);
  const masks = cameraMasks(job);
  const renderer = createRenderer(canvas, frames, { hooks: { ...(masks && { cameraMask: masks.cameraMask }), ...(jobCards && { drawCard: jobCards }) } });
  if (!masks) return { canvas, renderer };
  // The masks go with the renderer.
  const dispose = renderer.dispose.bind(renderer);
  return { canvas, renderer: { ...renderer, backend: renderer.backend, render: renderer.render.bind(renderer), dispose() { dispose(); masks.dispose(); } } };
}

/** A planar Float32 chunk as one AudioSample. */
function toSample(chunk: MixChunk): AudioSample {
  const n = chunk.data[0]?.length ?? 0;
  const data = new Float32Array(n * chunk.data.length);
  chunk.data.forEach((ch, c) => data.set(ch, c * n));
  return new AudioSample({ data, format: 'f32-planar', numberOfChannels: chunk.data.length, sampleRate: chunk.sampleRate, timestamp: chunk.timestamp });
}

/** An M4A next to the video: AAC where Chrome has it, else Opus. */
async function audioWriter(target: Target) {
  const { stream, handle } = await open(target);
  const aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: new StreamTarget(stream) });
  const source = new AudioSampleSource({ codec: aac ? 'aac' : 'opus', bitrate: 128_000 });
  output.addAudioTrack(source);
  await output.start();
  return { output, source, handle };
}

async function runVideo(id: number, job: VideoJob): Promise<void> {
  const { canvas, renderer } = setup(job);
  const length = cutLength(job.cut);
  const total = frameCount(length, job.fps);
  let opened: Awaited<ReturnType<typeof open>>;
  try {
    await loadFont();
    opened = await open(job.target);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  const { stream, handle } = opened;
  let writer: Writer | null = null;
  let m4a: Awaited<ReturnType<typeof audioWriter>> | null = null;
  try {
    writer = await createWriter({
      container: job.container, width: job.width, height: job.height, fps: job.fps, bitrate: job.bitrate,
      audio: job.audio ? { sampleRate: 48_000, channels: 2 } : false, hardware: job.hardware, stream,
    });
    if (job.audio && job.audioOnly) m4a = await audioWriter(job.audioOnly);
    await writer.start();

    // The mix stays a little ahead of the picture so the muxer can interleave without holding packets.
    let heard = 0;
    let ended = !job.audio;
    const audioTo = async (seconds: number) => {
      while (!ended && heard <= seconds) {
        reply({ type: 'need-audio', id });
        const chunk = await new Promise<MixChunk | null>((resolve) => { audioWaiter = resolve; });
        check(id);
        if (!chunk) {
          ended = true;
          break;
        }
        const sample = toSample(chunk);
        try {
          if (writer?.audio) await writer.audio.add(sample);
          if (m4a) await m4a.source.add(sample);
        } finally {
          sample.close();
        }
        heard = chunk.timestamp + (chunk.data[0]?.length ?? 0) / chunk.sampleRate;
      }
    };

    for (const f of frameSchedule(job.cut, length, job.fps)) {
      check(id);
      const t = f.out / 1000;
      await audioTo(t + 1);
      await renderer.render(renderPlan(job.project, job.cut, f.out, job.events, job.captions), job.cut.shape);
      const sample = new VideoSample(canvas, { timestamp: t, duration: 1 / job.fps });
      try {
        await writer.video.add(sample);
      } finally {
        sample.close();
      }
      if (f.index % 5 === 0) reply({ type: 'progress', id, done: f.index, total });
    }
    await audioTo(Number.POSITIVE_INFINITY);
    check(id);
    await writer.finish();
    if (m4a) await m4a.output.finalize();
    reply({ type: 'progress', id, done: total, total });
    reply({ type: 'done', id, file: await handle.getFile(), audio: m4a ? await m4a.handle.getFile() : undefined });
  } catch (error) {
    await writer?.cancel().catch(() => undefined);
    await m4a?.output.cancel().catch(() => undefined);
    await stream.abort().catch(() => undefined);
    throw error;
  } finally {
    renderer.dispose();
  }
}

/** Reads the picture back through a 2D canvas, whichever backend drew it. */
function readback(canvas: OffscreenCanvas): { scratch: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const scratch = new OffscreenCanvas(canvas.width, canvas.height);
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  return { scratch, ctx };
}

async function runGif(id: number, job: GifJob): Promise<void> {
  const { canvas, renderer } = setup(job);
  const length = cutLength(job.cut);
  const list = [...frameSchedule(job.cut, length, job.fps, job.from, job.to)];
  // GIF delays are whole hundredths of a second; each frame ends where its time rounds to, so the total stays exact.
  const delay = (i: number) => (Math.round((100 * (i + 1)) / job.fps) - Math.round((100 * i) / job.fps)) * 10;
  const gif = GIFEncoder();
  try {
    await loadFont();
    for (const [i, f] of list.entries()) {
      check(id);
      await renderer.render(renderPlan(job.project, job.cut, f.out, job.events, job.captions), job.cut.shape);
      const { ctx } = readback(canvas);
      const rgba = ctx.getImageData(0, 0, job.width, job.height).data;
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), job.width, job.height, { palette, delay: delay(i) });
      reply({ type: 'progress', id, done: i + 1, total: list.length });
    }
    gif.finish();
    const { stream, handle } = await open(job.target);
    await stream.write(gif.bytes() as Uint8Array<ArrayBuffer>);
    await stream.close();
    reply({ type: 'done', id, file: await handle.getFile() });
  } finally {
    renderer.dispose();
  }
}

async function runStill(id: number, job: StillJob): Promise<void> {
  const { canvas, renderer } = setup(job);
  try {
    await loadFont();
    await renderer.render(renderPlan(job.project, job.cut, job.out, job.events, job.captions), job.cut.shape);
    check(id);
    const { scratch, ctx } = readback(canvas);
    if (job.title && job.title.style !== 'none' && job.title.text.trim()) drawTitle(ctx, job.title.text, job.title.style, job.width, job.height);
    reply({ type: 'done', id, file: await scratch.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) });
  } finally {
    renderer.dispose();
  }
}

async function run(id: number, job: Job): Promise<void> {
  current = { id, cancelled: false };
  try {
    jobCards = await cardHook(job);
    if (job.kind === 'video') await runVideo(id, job);
    else if (job.kind === 'gif') await runGif(id, job);
    else await runStill(id, job);
  } catch (error) {
    if (error instanceof Cancelled) reply({ type: 'cancelled', id });
    else {
      console.error('Klipkord: could not export', error);
      reply({ type: 'error', id, message: describe(error) });
    }
  } finally {
    if (current?.id === id) current = null;
  }
}

self.addEventListener('message', (event: MessageEvent<ExportRequest>) => {
  const request = event.data;
  if (request.type === 'start') void run(request.id, request.job);
  else if (request.type === 'audio') {
    const waiter = audioWaiter;
    audioWaiter = null;
    waiter?.(request.chunk);
  } else if (current) {
    current.cancelled = true;
    const waiter = audioWaiter;
    audioWaiter = null;
    waiter?.(null);
  }
});
