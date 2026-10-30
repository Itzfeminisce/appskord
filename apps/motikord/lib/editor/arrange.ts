import { estimateMeasure } from '../checker';
import { canvasSize, safeBox } from '../render/reflow';
import { wrap, type Measure } from '../render/textFit';
import type { Box, Layer, Recipe, Scene, TextLayer } from '../types';

// Box maths for "Layout": where each layer of a scene goes for a layout id, on the recipe's main size. Pure.

const GAP = 0.02;
// Tall boxes lose height on wider sizes, so text gets room to spare.
const SLACK = 1.4;
const RANK: Record<TextLayer['role'], number> = { label: 0, title: 1, body: 2, caption: 3 };
const area = (b: Box) => b.w * b.h;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const round = (b: Box): Box => ({ x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) });

interface Plan { media: Box; text: Box }

function plan(layout: string, recipe: Recipe): Plan {
  const s = safeBox(recipe.aspect);
  const right = s.x + s.w;
  const bottom = s.y + s.h;
  const full: Box = { x: 0, y: 0, w: 1, h: 1 };
  const sideBySide = recipe.aspect !== '9:16';
  switch (layout) {
    case 'top': return { media: { x: 0, y: 0, w: 1, h: 0.5 }, text: { x: s.x, y: 0.5 + GAP, w: s.w, h: bottom - 0.5 - GAP } };
    case 'bottom': return { media: { x: 0, y: 0.5, w: 1, h: 0.5 }, text: { x: s.x, y: s.y, w: s.w, h: 0.5 - GAP - s.y } };
    case 'lower-third': { const top = Math.min(2 / 3, bottom - 0.2); return { media: full, text: { x: s.x, y: top, w: s.w, h: bottom - top } }; }
    case 'split': return sideBySide
      ? { media: { x: 0, y: 0, w: 0.5, h: 1 }, text: { x: 0.5 + s.x / 2, y: s.y, w: right - 0.5 - s.x / 2, h: s.h } }
      : plan('top', recipe);
    case 'full': { const h = s.h * 0.4; return { media: full, text: { x: s.x, y: bottom - h, w: s.w, h } }; }
    default: return { media: { ...s }, text: { ...s } };
  }
}

/** Text height as a fraction of the canvas, at the layer's own size. */
function textHeight(l: TextLayer, width: number, recipe: Recipe, measure: Measure): number {
  const { w, h } = canvasSize(recipe.aspect, 1080);
  const pad = l.background ? 32 : 0;
  const lines = wrap(l.text, width * w - pad, l.sizePx, measure).length;
  return (lines * l.sizePx * l.lineHeight + pad) * SLACK / h;
}

const visual = (l: Layer, recipe: Recipe) =>
  l.type === 'video' || l.type === 'chart' || (l.type === 'shape' && l.shape === 'circle') ||
  (l.type === 'image' && recipe.assets[l.assetId]?.kind !== 'logo');

/** The new box of every layer a layout moves, by layer id. Locked layers, full-bleed shapes and logos stay put. */
export function layoutBoxes(recipe: Recipe, scene: Scene, layout: string, measure: Measure = estimateMeasure): Map<string, Box> {
  const out = new Map<string, Box>();
  const free = scene.layers.filter((l) => !l.locked);
  const { media, text } = plan(layout, recipe);
  const s = safeBox(recipe.aspect);
  const { w: cw, h: ch } = canvasSize(recipe.aspect, 1080);

  const visuals = free.filter((l) => visual(l, recipe));
  const long = media.w * cw >= media.h * ch;
  visuals.forEach((l, i) => {
    const n = visuals.length;
    let b: Box = long ? { ...media, x: media.x + (media.w * i) / n, w: media.w / n } : { ...media, y: media.y + (media.h * i) / n, h: media.h / n };
    if (l.type === 'chart') b = clip(b, s);
    if (l.type === 'shape') { // a circle keeps its round shape on screen
      const side = Math.min(b.w * cw, b.h * ch);
      const w = side / cw;
      const h = side / ch;
      b = { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h };
    }
    out.set(l.id, round(b));
  });

  const texts = free.filter((l): l is TextLayer => l.type === 'text').sort((a, b) => RANK[a.role] - RANK[b.role]);
  const heights = texts.map((l) => textHeight(l, text.w, recipe, measure));
  const sum = heights.reduce((a, b) => a + b, 0);
  const gaps = GAP * Math.max(0, texts.length - 1);
  const k = Math.min(1, (text.h - gaps) / Math.max(sum, 1e-6));
  const total = sum * k + gaps;
  let y = text.y + (text.h - total) / 2;
  let block: Box | undefined;
  texts.forEach((l, i) => {
    const h = heights[i]! * k;
    out.set(l.id, round({ x: text.x, y, w: text.w, h }));
    y += h + GAP;
  });
  if (texts.length) block = { x: text.x, y: text.y + (text.h - total) / 2, w: text.w, h: total };

  if (block) {
    for (const l of free) {
      if (l.type !== 'shape' || visual(l, recipe)) continue;
      if (l.box.w >= 0.95 && l.box.h >= 0.95) continue;
      if (area(l.box) >= 0.08) { // a card behind the text
        const px = 0.03;
        const py = 0.015;
        const x = Math.max(0, block.x - px);
        const y0 = Math.max(0, block.y - py);
        out.set(l.id, round({ x, y: y0, w: Math.min(1, block.x + block.w + px) - x, h: Math.min(1, block.y + block.h + py) - y0 }));
      } else { // a rule or small mark sits just above the text
        const w = Math.min(l.box.w, block.w);
        out.set(l.id, round({ x: block.x, y: Math.max(0, block.y - l.box.h - GAP / 2), w, h: l.box.h }));
      }
    }
  }
  return out;
}

function clip(b: Box, s: Box): Box {
  const x = Math.max(b.x, s.x);
  const y = Math.max(b.y, s.y);
  return { x, y, w: Math.min(b.x + b.w, s.x + s.w) - x, h: Math.min(b.y + b.h, s.y + s.h) - y };
}
