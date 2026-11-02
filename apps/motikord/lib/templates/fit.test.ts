import { describe, expect, it } from 'vitest';
import { check } from '../checker';
import { canvasSize, boxFor } from '../render/reflow';
import { estimateFor, fitText } from '../render/textFit';
import type { Aspect, Recipe, Scene, SceneTemplate, SlotValue, TextLayer } from '../types';
import { expandScene } from './expand';
import { SCENE_TEMPLATES, STYLE_PACKS } from './scenes';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const WORDS = ['people', 'simple', 'really', 'better', 'moment', 'always', 'create', 'friend'];
const words = (n: number, w?: string) => Array.from({ length: n }, (_, i) => w ?? WORDS[i % WORDS.length]).join(' ');
/** Realistic: average English word length (6 letters). */
const long = (n: number) => words(n);

/** Every slot filled to its word limit with long words, and to its most items; with `first`, each headline slot holds just that word. */
function maxSlots(t: SceneTemplate, first?: string): Record<string, SlotValue> {
  const out: Record<string, SlotValue> = {};
  for (const d of t.slots) {
    const n = d.items?.[1] ?? 1;
    const text = (k: number) => (first && (d.scale === 'display' || d.scale === 'headline') ? first : long(k));
    if (d.kind === 'text') out[d.id] = d.id === 'highlight' ? 'simple' : d.scale === 'number' ? '1,200' : text(d.words ?? 3);
    else if (d.kind === 'items') out[d.id] = Array.from({ length: n }, () => long(d.words ?? 3));
    else if (d.kind === 'chart') out[d.id] = Array.from({ length: n }, (_, i) => ({ label: long(d.words ?? 1), value: i + 1 }));
    else out[d.id] = { assetId: d.kind === 'logo' ? 'logo' : 'photo' };
  }
  return out;
}

function recipeFor(t: SceneTemplate, p: (typeof STYLE_PACKS)[number], aspect: Aspect, first?: string): Recipe {
  const s: Scene = { id: 's1', durationMs: t.defaultMs, background: '#FFFFFF', layout: 'center', layers: [], template: t.id, slots: maxSlots(t, first) };
  return {
    version: 2, id: 'r', name: 'Fit', type: 'promo', aspect, style: p.id, scenes: [expandScene(s, p)],
    assets: {
      photo: { id: 'photo', kind: 'image', name: 'P', mime: 'image/jpeg', bytes: 10, opfsPath: 'media/photo.jpg' },
      logo: { id: 'logo', kind: 'logo', name: 'l.png', mime: 'image/png', bytes: 10, opfsPath: 'media/logo.png' },
    },
  };
}
function issuesFor(t: SceneTemplate, p: (typeof STYLE_PACKS)[number], aspect: Aspect, first?: string) {
  return check(recipeFor(t, p, aspect, first)).filter((i) => ['overflow', 'contrast', 'overlap', 'safe-area', 'too-small'].includes(i.kind));
}
const label = (i: { kind: string; layerId: string; aspect: string }) => `${i.kind} ${i.layerId} ${i.aspect}`;

describe('realistic max-length text (6-letter words at every word limit) fits and keeps contrast', () => {
  for (const t of SCENE_TEMPLATES) for (const p of STYLE_PACKS) for (const aspect of ASPECTS) {
    it(`${t.id} / ${p.id} / ${aspect}`, () => {
      expect(issuesFor(t, p, aspect).map(label)).toEqual([]);
    });
  }
});

describe('a 9-letter word in every headline slot and "1,200" in the stat slot fit at slot size, never split', () => {
  for (const t of SCENE_TEMPLATES) for (const p of STYLE_PACKS) for (const aspect of ASPECTS) {
    it(`${t.id} / ${p.id} / ${aspect}`, () => {
      expect(issuesFor(t, p, aspect, 'sourdough').map(label)).toEqual([]);
      const scene = recipeFor(t, p, aspect, 'sourdough').scenes[0]!;
      for (const l of scene.layers.filter((x): x is TextLayer => x.type === 'text')) {
        const b = boxFor(l, aspect, aspect, scene.layout);
        const { w, h } = canvasSize(aspect, 1080);
        const pad = l.background && !l.pill ? 32 : 0;
        const fit = fitText({ text: l.text, width: b.w * w - pad, height: b.h * h - pad, maxSize: l.sizePx, minSize: l.sizePx, lineHeight: l.lineHeight, measure: estimateFor(l.font, l.letterSpacing) });
        expect(fit.lines.join(' ').split(/\s+/)).toEqual(l.text.trim().split(/\s+/));
        expect(fit.fits, `${l.id} "${l.text}"`).toBe(true);
      }
    });
  }
});
