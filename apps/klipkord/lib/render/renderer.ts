import type { RenderPlan, Shape } from '../project/types';
import { canvas2dBackend, type MakeCanvas } from './canvas2d';
import { webgl2Backend } from './gl';
import type { DrawCard } from './layers/cards';
import type { Ctx2D } from './layers/path';
import { layerOrder } from './layers/order';
import { isVideoFrame, type Backend, type Picture, type Scene } from './layers/scene';
import { FRAME } from './plan';

export type { Picture } from './layers/scene';
export type { DrawCard, CardInfo } from './layers/cards';

/**
 * Pictures by source id and time (ms of that source). A VideoFrame handed over becomes the renderer's, which closes
 * it; ImageBitmaps and canvases stay the provider's. Null: no new picture, so the last one for that source is kept.
 */
export interface FrameProvider {
  frame(source: string, t: number): Promise<Picture | null>;
}

/** The person mask for "Blur behind you" (T11): alpha 1 on the person, same framing as `camera`. Owned by the hook. */
export type CameraMask = (camera: Picture, source: string, t: number) => Picture | null | Promise<Picture | null>;

export interface RenderHooks { drawCard?: DrawCard; cameraMask?: CameraMask }

export interface RendererOptions {
  hooks?: RenderHooks;
  /** Force a backend; by default WebGL2 when the canvas has it, else Canvas 2D. */
  backend?: Backend['kind'];
  /** Scratch canvases; `OffscreenCanvas` by default. */
  makeCanvas?: MakeCanvas;
}

export interface Renderer {
  readonly backend: Backend['kind'];
  /** Draws one plan. Calls run one after another, so the last call's picture is the one left on the canvas. */
  render(plan: RenderPlan, shape: Shape): Promise<void>;
  setHooks(hooks: RenderHooks): void;
  /** Preview and export size are only the canvas size. */
  resize(width: number, height: number): void;
  /** Closes every frame the renderer still holds. */
  dispose(): void;
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function pickBackend(canvas: Canvas, options: RendererOptions): Backend {
  if (options.backend !== 'canvas2d') {
    try {
      const gl = webgl2Backend(canvas, options.makeCanvas);
      if (gl) return gl;
    } catch (error) {
      console.error('Klipkord: could not start WebGL2, drawing with Canvas 2D', error);
    }
  }
  const ctx = (canvas as OffscreenCanvas).getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('No 2D context on the render canvas');
  return canvas2dBackend(ctx, options.makeCanvas);
}

/** One renderer for preview and export: draws a RenderPlan to `canvas` with frames from `frames`. */
export function createRenderer(canvas: Canvas, frames: FrameProvider, options: RendererOptions = {}): Renderer {
  const backend = pickBackend(canvas, options);
  let hooks: RenderHooks = { ...options.hooks };
  // The last picture per source: shown again while a newer frame is on its way, closed when replaced.
  const held = new Map<string, Picture>();
  const wanted = new Map<string, number>();
  let queue: Promise<void> = Promise.resolve();
  let disposed = false;

  const fetch = async (source: string, t: number): Promise<Picture | null> => {
    let pic: Picture | null = null;
    try {
      pic = await frames.frame(source, t);
    } catch (error) {
      console.error('Klipkord: could not decode frame', error);
    }
    if (!pic) return held.get(source) ?? null;
    const prev = held.get(source);
    if (prev && prev !== pic && isVideoFrame(prev)) prev.close();
    if (disposed) {
      if (isVideoFrame(pic)) pic.close();
      return null;
    }
    held.set(source, pic);
    return pic;
  };

  const scene: Scene = {
    plan: null as unknown as RenderPlan, frame: FRAME['16:9'], width: 0, height: 0, scale: { x: 1, y: 1 },
    screen: null, camera: null, media: null, background: null, mask: null, layers: [],
  };

  const draw = async (plan: RenderPlan, shape: Shape) => {
    if (disposed) return;
    // One request per source even when the screen is also the blurred background.
    wanted.clear();
    if (plan.screen) wanted.set(plan.screen.source, plan.screen.t);
    if (plan.camera) wanted.set(plan.camera.source, plan.camera.t);
    if (plan.media) wanted.set(plan.media.source, plan.media.t);
    if (plan.background.kind === 'image' && !wanted.has(plan.background.value)) wanted.set(plan.background.value, 0);
    const got = new Map<string, Picture | null>();
    await Promise.all([...wanted].map(async ([source, t]) => got.set(source, await fetch(source, t))));
    if (disposed) return;

    const camera = plan.camera ? (got.get(plan.camera.source) ?? null) : null;
    let mask: Picture | null = null;
    if (camera && plan.camera?.blur.on && hooks.cameraMask) {
      try {
        mask = await hooks.cameraMask(camera, plan.camera.source, plan.camera.t);
      } catch (error) {
        console.error('Klipkord: could not find the person for camera blur', error);
      }
    }
    if (disposed) return;

    scene.plan = plan;
    scene.frame = FRAME[shape];
    scene.width = canvas.width;
    scene.height = canvas.height;
    scene.scale.x = canvas.width / scene.frame.w;
    scene.scale.y = canvas.height / scene.frame.h;
    scene.screen = plan.screen ? (got.get(plan.screen.source) ?? null) : null;
    scene.camera = camera;
    scene.mask = mask;
    scene.media = plan.media ? (got.get(plan.media.source) ?? null) : null;
    scene.background = plan.background.kind === 'image' ? (got.get(plan.background.value) ?? null)
      : plan.background.kind === 'blurred' ? scene.screen : null;
    scene.drawCard = hooks.drawCard;
    scene.layers = layerOrder(plan, !!hooks.drawCard);
    backend.draw(scene);
  };

  return {
    backend: backend.kind,
    render(plan, shape) {
      const next = queue.then(() => draw(plan, shape));
      queue = next.catch(() => {});
      return next;
    },
    setHooks(next) {
      hooks = { ...hooks, ...next };
    },
    resize(width, height) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
    },
    dispose() {
      disposed = true;
      for (const pic of held.values()) if (isVideoFrame(pic)) pic.close();
      held.clear();
      backend.dispose();
    },
  };
}
