// Key-frame stills and quality-check frames are drawn by the render page in a hidden frame, never in the side panel,
// so the panel imports no three.js. When the page can't draw, a still falls back to the scene's words on the
// look's ground colour.
import type { LayerContent } from '@appskord/motion/draw';
import type { ClipV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import type { ClipFrames } from '../../lib/critic/v3';
import type { Aspect, Recipe } from '../../lib/types';
import { RENDER_PORT, renderClient, type RenderAsk } from '../../lib/v3/renderChannel';
import { sceneContents } from '../../lib/v3/text';

export interface StillContext { look?: LookGuide; contents: Record<string, LayerContent> }
/** A small picture URL of the scene at `atMs`, or undefined when it can't be drawn. */
export type StillRenderer = (scene: SceneV3, atMs: number, size: { width: number; height: number }, context: StillContext) => Promise<string | undefined>;
export type FramesFor = (recipe: Recipe, look?: LookGuide) => ClipFrames;

/** What every layer of a clip draws at `aspect`, keyed `${sceneIndex}:${layerId}`. */
export function clipContents(clip: ClipV3, recipe: Recipe, aspect: Aspect): Record<string, LayerContent> {
  const out: Record<string, LayerContent> = {};
  clip.scenes.forEach((s, i) => {
    for (const [id, c] of Object.entries(sceneContents(s, recipe.scenes[i], aspect, recipe.aspect))) out[`${i}:${id}`] = c;
  });
  return out;
}

let page: Promise<RenderAsk | undefined> | undefined;
/** Loads the render page once, in a hidden frame of this document, and hands it a port only this panel holds. */
function renderPage(): Promise<RenderAsk | undefined> {
  page ??= new Promise<RenderAsk | undefined>((resolve) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    const url = browser.runtime.getURL('/render.html');
    frame.addEventListener('load', () => {
      const { port1, port2 } = new MessageChannel();
      // Posted to the extension's origin only, so a frame that navigated elsewhere never gets the port.
      frame.contentWindow?.postMessage({ type: RENDER_PORT }, new URL(url).origin, [port2]);
      resolve(renderClient(port1));
    }, { once: true });
    // A frame that never loads leaves the stills as words rather than waiting forever.
    setTimeout(() => resolve(undefined), 10_000);
    frame.src = url;
    document.body.append(frame);
  });
  return page;
}

const noPage = () => new Error('The render page did not load');
const portStill: StillRenderer = async (scene, atMs, size, c) => {
  const ask = await renderPage();
  if (!ask) throw noPage();
  return ask({ type: 'still', scene, atMs, size, look: c.look, contents: c.contents });
};
const portFrames: FramesFor = (recipe, look) => async (clip, times) => {
  const ask = await renderPage();
  if (!ask) throw noPage();
  // The render page draws check frames 1080 x 1920.
  return ask({ type: 'frames', clip, times, look, contents: clipContents(clip, recipe, '9:16') });
};

let still: StillRenderer = portStill;
let frames: FramesFor = portFrames;

/** Tests swap the renderers. */
export function setRenderers(r: { still?: StillRenderer; frames?: FramesFor }): void {
  still = r.still ?? portStill;
  frames = r.frames ?? portFrames;
}
export const clipFrames = (recipe: Recipe, look?: LookGuide): ClipFrames => frames(recipe, look);

export async function renderStill(scene: SceneV3, atMs: number, size: { width: number; height: number }, context: StillContext = { contents: {} }): Promise<string | undefined> {
  try {
    return await still(scene, atMs, size, context);
  } catch (error) {
    console.error('Motikord: could not draw a key frame', error);
    return undefined;
  }
}

export type { ClipV3 };
