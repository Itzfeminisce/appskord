// Key-frame stills and quality-check frames are drawn by the render page in a hidden frame, never in the side panel,
// so the panel imports no three.js. When the page can't draw, a still falls back to the scene's words on the
// look's ground colour.
import type { ClipV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import type { ClipFrames } from '../../lib/critic/v3';
import type { Recipe, Scene } from '../../lib/types';
import { RENDER_PORT, renderClient, type RenderAsk } from '../../lib/v3/renderChannel';
import { sceneLayerText } from '../../lib/v3/text';

export interface StillContext { look?: LookGuide; texts: Record<string, string> }
/** A small picture URL of the scene at `atMs`, or undefined when it can't be drawn. */
export type StillRenderer = (scene: SceneV3, atMs: number, size: { width: number; height: number }, context: StillContext) => Promise<string | undefined>;
export type FramesFor = (recipe: Recipe, look?: LookGuide) => ClipFrames;

/** The words of each text layer of a v3 scene, by layer id, read from its v2 scene. */
export function sceneTexts(scene: SceneV3, v2: Scene | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of scene.layers) {
    const text = l.kind === 'text' ? sceneLayerText(v2, l) : undefined;
    if (text !== undefined) out[l.id] = text;
  }
  return out;
}

/** The words of every text layer of a clip, keyed `${sceneIndex}:${layerId}`. */
export function clipTexts(clip: ClipV3, recipe: Recipe): Record<string, string> {
  const out: Record<string, string> = {};
  clip.scenes.forEach((s, i) => {
    for (const [id, text] of Object.entries(sceneTexts(s, recipe.scenes[i]))) out[`${i}:${id}`] = text;
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
  return ask({ type: 'still', scene, atMs, size, look: c.look, texts: c.texts });
};
const portFrames: FramesFor = (recipe, look) => async (clip, times) => {
  const ask = await renderPage();
  if (!ask) throw noPage();
  return ask({ type: 'frames', clip, times, look, texts: clipTexts(clip, recipe) });
};

let still: StillRenderer = portStill;
let frames: FramesFor = portFrames;

/** Tests swap the renderers. */
export function setRenderers(r: { still?: StillRenderer; frames?: FramesFor }): void {
  still = r.still ?? portStill;
  frames = r.frames ?? portFrames;
}
export const clipFrames = (recipe: Recipe, look?: LookGuide): ClipFrames => frames(recipe, look);

export async function renderStill(scene: SceneV3, atMs: number, size: { width: number; height: number }, context: StillContext = { texts: {} }): Promise<string | undefined> {
  try {
    return await still(scene, atMs, size, context);
  } catch (error) {
    console.error('Motikord: could not draw a key frame', error);
    return undefined;
  }
}

export type { ClipV3 };
