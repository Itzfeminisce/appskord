import { describe, expect, it } from 'vitest';
import { check } from '../checker';
import type { Aspect, Recipe, Scene, SceneTemplate, SlotValue } from '../types';
import { expandScene } from './expand';
import { SCENE_TEMPLATES, STYLE_PACKS } from './scenes';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const WORDS = ['people', 'simple', 'really', 'better', 'moment', 'always', 'create', 'friend'];
const words = (n: number, w?: string) => Array.from({ length: n }, (_, i) => w ?? WORDS[i % WORDS.length]).join(' ');
/** Realistic: average English word length (6 letters). */
const long = (n: number) => words(n);

/** Every slot filled to its word limit with long words, and to its most items. */
function maxSlots(t: SceneTemplate): Record<string, SlotValue> {
  const out: Record<string, SlotValue> = {};
  for (const d of t.slots) {
    const n = d.items?.[1] ?? 1;
    if (d.kind === 'text') out[d.id] = d.id === 'highlight' ? 'simple' : d.scale === 'number' ? '1,200' : long(d.words ?? 3);
    else if (d.kind === 'items') out[d.id] = Array.from({ length: n }, () => long(d.words ?? 3));
    else if (d.kind === 'chart') out[d.id] = Array.from({ length: n }, (_, i) => ({ label: long(d.words ?? 1), value: i + 1 }));
    else out[d.id] = { assetId: d.kind === 'logo' ? 'logo' : 'photo' };
  }
  return out;
}

function issuesFor(t: SceneTemplate, p: (typeof STYLE_PACKS)[number], aspect: Aspect) {
  const s: Scene = { id: 's1', durationMs: t.defaultMs, background: '#FFFFFF', layout: 'center', layers: [], template: t.id, slots: maxSlots(t) };
  const r: Recipe = {
    version: 2, id: 'r', name: 'Fit', type: 'promo', aspect, style: p.id, scenes: [expandScene(s, p)],
    assets: {
      photo: { id: 'photo', kind: 'image', name: 'P', mime: 'image/jpeg', bytes: 10, opfsPath: 'media/photo.jpg' },
      logo: { id: 'logo', kind: 'logo', name: 'l.png', mime: 'image/png', bytes: 10, opfsPath: 'media/logo.png' },
    },
  };
  return check(r).filter((i) => ['overflow', 'contrast', 'overlap', 'safe-area', 'too-small'].includes(i.kind));
}
const label = (i: { kind: string; layerId: string; aspect: string }) => `${i.kind} ${i.layerId} ${i.aspect}`;

describe('realistic max-length text (6-letter words at every word limit) fits and keeps contrast', () => {
  for (const t of SCENE_TEMPLATES) for (const p of STYLE_PACKS) for (const aspect of ASPECTS) {
    it(`${t.id} / ${p.id} / ${aspect}`, () => {
      expect(issuesFor(t, p, aspect).map(label)).toEqual([]);
    });
  }
});
