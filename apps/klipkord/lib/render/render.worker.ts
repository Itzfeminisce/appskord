import { framesClient, type FramesClient } from '@appskord/media';
import FramesWorker from '@appskord/media/frames.worker?worker';
import geistUrl from '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url';
import type { RenderPlan, Shape } from '../project/types';
import { createRenderer, type FrameProvider, type Picture, type Renderer } from './renderer';
import { cameraMasks, PREVIEW_SEGMENT, workerSegmenter, type CameraMasks } from './segment';
import SegmentWorker from './segment.worker?worker';

// Preview worker: the editor transfers an OffscreenCanvas and posts a plan per frame. Export (T9) uses createRenderer.

/** A file the plan can name: a video track (screen, camera, added video) or an image. */
export interface RenderSource { id: string; blob: Blob; image: boolean }

export type RenderRequest =
  | { type: 'init'; canvas: OffscreenCanvas; sources: RenderSource[]; backend?: Renderer['backend'] }
  | { type: 'sources'; sources: RenderSource[] }
  | { type: 'render'; id: number; plan: RenderPlan; shape: Shape }
  | { type: 'resize'; width: number; height: number }
  | { type: 'close' };

export type RenderResponse =
  | { type: 'ready'; backend: Renderer['backend'] }
  /** drawn: false when a newer plan replaced this one before it was drawn. */
  | { type: 'rendered'; id: number; drawn: boolean }
  | { type: 'error'; id?: number; message: string }
  /** The answer to 'close': everything is let go, so the worker can be ended. */
  | { type: 'closed' };

const reply = (message: RenderResponse) => self.postMessage(message);
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

const videos = new Map<string, Promise<FramesClient | null>>();
const images = new Map<string, Promise<ImageBitmap | null>>();
let renderer: Renderer | null = null;
let masks: CameraMasks | null = null;
let last: Extract<RenderRequest, { type: 'render' }> | null = null;
let busy = false;
let waiting: Extract<RenderRequest, { type: 'render' }> | null = null;
let again = false;
let blurring = false;

function addSources(sources: RenderSource[]): void {
  for (const s of sources) {
    if (videos.has(s.id) || images.has(s.id)) continue;
    if (s.image) {
      images.set(s.id, createImageBitmap(s.blob).catch((error: unknown) => {
        console.error('Klipkord: could not open image', error);
        return null;
      }));
      continue;
    }
    const client = framesClient(new FramesWorker());
    videos.set(s.id, client.open(s.blob).then(() => client, (error: unknown) => {
      console.error('Klipkord: could not open video', error);
      client.close();
      return null;
    }));
  }
}

const frames: FrameProvider = {
  async frame(source, t): Promise<Picture | null> {
    const image = images.get(source);
    if (image) return image;
    const client = await videos.get(source);
    return client ? client.frameAt(Math.max(0, t) / 1000) : null;
  },
};

async function loadFont(): Promise<void> {
  try {
    const face = new FontFace('Geist', `url(${geistUrl})`, { weight: '100 900' });
    (self as unknown as { fonts: FontFaceSet }).fonts.add(await face.load());
  } catch (error) {
    console.error('Klipkord: could not load font', error);
  }
}

// Only the newest plan matters while playing or scrubbing; older ones are answered as not drawn.
function render(request: Extract<RenderRequest, { type: 'render' }>): void {
  if (busy) {
    if (waiting) reply({ type: 'rendered', id: waiting.id, drawn: false });
    waiting = request;
    return;
  }
  if (!renderer) return reply({ type: 'error', id: request.id, message: 'Renderer not started' });
  void draw(renderer, request, true);
}

// A blur mask made in the background: draw the shown frame again, after the draw running now, unless a newer one waits.
function redraw(): void {
  if (!last || !renderer) return;
  if (busy) again = true;
  else if (!waiting) void draw(renderer, last, false);
}

async function draw(r: Renderer, request: Extract<RenderRequest, { type: 'render' }>, answer: boolean): Promise<void> {
  busy = true;
  again = false;
  last = request;
  const camera = request.plan.camera;
  // The segmentation worker holds the model in memory; let it go once the camera is shown without blur.
  if (camera && !camera.blur.on && blurring) masks?.release();
  if (camera) blurring = camera.blur.on;
  try {
    await r.render(request.plan, request.shape);
    if (answer) reply({ type: 'rendered', id: request.id, drawn: true });
  } catch (error) {
    console.error('Klipkord: could not draw frame', error);
    if (answer) reply({ type: 'error', id: request.id, message: describe(error) });
  } finally {
    busy = false;
    const next = waiting;
    waiting = null;
    if (next) render(next);
    else if (again) redraw();
  }
}

function close(): void {
  renderer?.dispose();
  renderer = null;
  masks?.dispose();
  masks = null;
  last = null;
  blurring = false;
  for (const client of videos.values()) void client.then((c) => c?.close());
  for (const image of images.values()) void image.then((b) => b?.close());
  videos.clear();
  images.clear();
}

self.addEventListener('message', (event: MessageEvent<RenderRequest>) => {
  const request = event.data;
  switch (request.type) {
    case 'init':
      void loadFont();
      try {
        close();
        addSources(request.sources);
        // The segmentation worker starts on the first frame drawn with "Blur behind you" on.
        masks = cameraMasks(workerSegmenter(() => new SegmentWorker()), { ...PREVIEW_SEGMENT, onMask: redraw });
        renderer = createRenderer(request.canvas, frames, { backend: request.backend, hooks: { cameraMask: masks.cameraMask } });
        reply({ type: 'ready', backend: renderer.backend });
      } catch (error) {
        reply({ type: 'error', message: describe(error) });
      }
      break;
    case 'sources': addSources(request.sources); break;
    case 'render': render(request); break;
    case 'resize': renderer?.resize(request.width, request.height); break;
    case 'close':
      close();
      reply({ type: 'closed' });
      break;
  }
});
