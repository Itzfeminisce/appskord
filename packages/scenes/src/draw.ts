import type { Aspect, BrandKit, Scene, SlotValue, StyleId, TemplateId } from './types';
import { renderCacheFor, type SceneCache } from './render/cache';
import { drawFrame, type Ctx } from './render/drawFrame';
import { expandScene } from './templates/expand';
import { getPack, getSceneTemplate } from './templates/scenes';

/** How a scene looks: a style pack and, optionally, a brand kit that replaces its colours, fonts and logo. */
export interface SceneLook {
  style: StyleId;
  brand?: BrandKit;
}

/** One templated scene: which template, what fills its slots, and its look; durationMs defaults to the template's. */
export interface SceneSpec {
  template: TemplateId;
  slots: Record<string, SlotValue>;
  look: SceneLook;
  durationMs?: number;
}

/** The scene's layers for every size, as Motikord's expand makes them; undefined for an unknown template or style. */
export function expandSpec(spec: SceneSpec): Scene | undefined {
  const tpl = getSceneTemplate(spec.template);
  const pack = getPack(spec.look.style);
  if (!tpl || !pack) return undefined;
  const durationMs = spec.durationMs ?? tpl.defaultMs;
  const bare: Scene = {
    id: tpl.id,
    durationMs,
    background: pack.palette.bg,
    layout: 'center',
    layers: [],
    template: tpl.id,
    slots: spec.slots,
  };
  return expandScene(bare, pack, spec.look.brand);
}

let last: { key: string; scene: Scene | undefined } | undefined;
const expandOnce = (spec: SceneSpec) => {
  const key = JSON.stringify(spec);
  if (last?.key !== key) last = { key, scene: expandSpec(spec) };
  return last.scene;
};

/**
 * Draws the scene at tMs onto ctx, filling its whole canvas at `aspect`: background, blocks, text in the pack fonts,
 * and each layer's in and out motion. Pass a cache for images and font readiness; Motikord's MediaCache is one.
 */
export function drawScene(ctx: Ctx, spec: SceneSpec, aspect: Aspect, tMs: number, cache?: SceneCache): void {
  const scene = expandOnce(spec);
  if (!scene) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    return;
  }
  drawFrame(ctx, { aspect, scenes: [scene], style: spec.look.style }, aspect, tMs, renderCacheFor(cache));
}
