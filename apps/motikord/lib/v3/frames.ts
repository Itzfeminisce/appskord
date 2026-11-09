// Draws v3 scenes with packages/motion's V3Renderer for export, quality-check frames and key-frame stills.
// Heavy (three.js): only the editor's export and check routes and the render page import it, always lazily.
import { fontUrl } from '@appskord/motion/assets';
import type { EffectUse } from '@appskord/motion/effects';
import { DEFAULT_FINISH } from '@appskord/motion/finish';
import { createCanvasRenderer, V3Renderer } from '@appskord/motion/renderer';
import type { LayerContent } from '@appskord/motion/draw';
import type { ClipV3, Finish, LookGuide, SceneV3 } from '@appskord/motion/types';
import type { ClipFrames } from '../critic/v3';
import { aspectOfSize, type LayerContents } from './text';

export interface DrawSetup {
  width: number;
  height: number;
  quality: 'full' | 'reduced';
  fps: number;
  look?: LookGuide;
  finish?: Finish;
  effects?: readonly EffectUse[];
}

type Gl = ReturnType<typeof createCanvasRenderer>;
interface Node3 { children: Node3[]; _isSyncing?: boolean }

/** Troika typesets text off the frame loop; waits until nothing is typesetting so a frame shows its words. False on timeout. */
export async function textReady(root: Node3, timeoutMs = 10_000, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<boolean> {
  const busy = (n: Node3): boolean => !!n._isSyncing || n.children.some(busy);
  for (let waited = 0; busy(root); waited += 16) {
    if (waited >= timeoutMs) return false;
    await wait(16);
  }
  return true;
}

/** Thrown when a scene's text is still typesetting after the wait. */
export class TextNotReady extends Error {
  constructor(readonly sceneIndex: number) { super(`Scene ${sceneIndex + 1}'s text did not typeset in time`); this.name = 'TextNotReady'; }
}

/** True when `work` settles within `ms`; false on timeout. Rejections pass through. */
async function within(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((r) => { timer = setTimeout(() => r(false), ms); });
  try {
    return await Promise.race([work.then(() => true as const), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The scene playing at `tMs` on the clip's timeline and the time inside it; the very end stays on the last scene. */
export function sceneAt(clip: ClipV3, tMs: number): { index: number; local: number } {
  let start = 0;
  for (let i = 0; i < clip.scenes.length; i++) {
    const ms = clip.scenes[i]!.ms;
    if (tMs < start + ms || i === clip.scenes.length - 1) return { index: i, local: Math.max(0, Math.min(ms, tMs - start)) };
    start += ms;
  }
  return { index: 0, local: 0 };
}

function viewFor(scene: SceneV3, i: number, contents: LayerContents, s: DrawSetup): V3Renderer {
  const aspect = aspectOfSize(s);
  return new V3Renderer(scene, {
    width: s.width, height: s.height, quality: s.quality, fps: s.fps, fontUrl, look: s.look, finish: s.finish, effects: s.effects,
    content: (l) => contents(i, l, aspect),
  });
}

/** Draws a whole clip frame by frame onto one canvas: one renderer per scene, built when its scene starts. */
export class ClipDrawer {
  private view: V3Renderer | undefined;
  private index = -1;
  private disposed = false;
  private readonly gl: Gl;

  constructor(readonly clip: ClipV3, private readonly contents: LayerContents, private readonly setup: DrawSetup, readonly canvas: HTMLCanvasElement | OffscreenCanvas, private readonly timeoutMs = 10_000) {
    this.gl = createCanvasRenderer(canvas);
  }

  async draw(tMs: number): Promise<void> {
    const { index, local } = sceneAt(this.clip, tMs);
    if (index !== this.index) {
      this.view?.dispose();
      this.view = undefined;
      const view = viewFor(this.clip.scenes[index]!, index, this.contents, this.setup);
      this.view = view;
      this.index = index;
      view.attach(this.gl);
      // Blank words are never drawn: a scene whose text won't typeset fails the export, still or check frame.
      if (!(await textReady(view.three as unknown as Node3, this.timeoutMs))) throw new TextNotReady(index);
    }
    // Counts and kinetic type retypeset as they change, so every frame waits for its own words before drawing.
    if (this.disposed || !this.view) throw new TextNotReady(index);
    const ready = await within(this.view.renderReady(local), this.timeoutMs);
    // A timeout can resolve after dispose; the renderer is gone, so nothing is drawn.
    if (this.disposed) throw new TextNotReady(index);
    if (!ready) throw new TextNotReady(index);
  }

  dispose(): void {
    this.disposed = true;
    this.view?.dispose();
    this.view = undefined;
    // Hand the GPU context back now rather than when the canvas is collected.
    this.gl.forceContextLoss();
    this.gl.dispose();
  }
}

const canvasOf = (w: number, h: number): HTMLCanvasElement => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** A JPEG data URL of `source` scaled to w x h. */
function jpeg(source: CanvasImageSource, w: number, h: number, quality = 0.8): string {
  const out = canvasOf(w, h);
  out.getContext('2d')!.drawImage(source, 0, 0, w, h);
  return out.toDataURL('image/jpeg', quality);
}

const FRAME_LONG = 512;

/** The quality check's frames: the clip drawn at reduced quality, each a small JPEG. */
export function clipFramesFor(contents: LayerContents, look: LookGuide | undefined, size = { width: 1080, height: 1920 }): ClipFrames {
  return async (clip, times) => {
    const canvas = canvasOf(size.width, size.height);
    const drawer = new ClipDrawer(clip, contents, { ...size, quality: 'reduced', fps: clip.fps, look, finish: clip.finish, effects: clip.effects }, canvas);
    const k = FRAME_LONG / Math.max(size.width, size.height);
    try {
      const out: string[] = [];
      for (const t of times) {
        await drawer.draw(t);
        out.push(jpeg(canvas, Math.round(size.width * k), Math.round(size.height * k), 0.7));
      }
      return out;
    } finally {
      drawer.dispose();
    }
  };
}

/** One key-frame still of `scene` at `atMs`, as a JPEG data URL of `size` (drawn at twice that for sharp screens). */
export async function stillUrl(scene: SceneV3, atMs: number, size: { width: number; height: number }, look: LookGuide | undefined, contents: Record<string, LayerContent>): Promise<string> {
  const clip: ClipV3 = { version: 3, scenes: [scene], lookGuideId: look?.id ?? '', packId: '', fps: 30, finish: DEFAULT_FINISH };
  const canvas = canvasOf(1080, Math.round((1080 * size.height) / size.width));
  const drawer = new ClipDrawer(clip, (_i, l) => contents[l.id], { width: canvas.width, height: canvas.height, quality: 'full', fps: 30, look, finish: DEFAULT_FINISH }, canvas);
  try {
    await drawer.draw(atMs);
    return jpeg(canvas, size.width * 2, size.height * 2);
  } finally {
    drawer.dispose();
  }
}
