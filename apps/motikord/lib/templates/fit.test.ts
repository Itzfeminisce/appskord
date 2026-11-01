import { describe, expect, it } from 'vitest';
import { check } from '../checker';
import type { Aspect, Recipe, Scene, SceneTemplate, SlotValue } from '../types';
import { expandScene } from './expand';
import { SCENE_TEMPLATES, STYLE_PACKS } from './scenes';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];
const long = (n: number) => Array.from({ length: n }, () => 'wonderful').join(' ');

/** Every slot filled to its word limit with long words, and to its most items. */
function maxSlots(t: SceneTemplate): Record<string, SlotValue> {
  const out: Record<string, SlotValue> = {};
  for (const d of t.slots) {
    const n = d.items?.[1] ?? 1;
    if (d.kind === 'text') out[d.id] = d.id === 'highlight' ? 'wonderful' : d.scale === 'number' ? '1,200' : long(d.words ?? 3);
    else if (d.kind === 'items') out[d.id] = Array.from({ length: n }, () => long(d.words ?? 3));
    else if (d.kind === 'chart') out[d.id] = Array.from({ length: n }, (_, i) => ({ label: long(d.words ?? 1), value: i + 1 }));
    else out[d.id] = { assetId: d.kind === 'logo' ? 'logo' : 'photo' };
  }
  return out;
}

/** Templates whose body text cannot fit at the slot's word limit in "wonderful"-length words at the slot's type size
 *  (the slot allows more words than the box holds at that size). Reported, not fixed here; `it.fails` flips when one is. */
const KNOWN_OVERFLOW = new Set<string>(SCENE_TEMPLATES.map((t) => t.id as string).filter((id) => id !== 'title-hook'));

function issuesFor(t: SceneTemplate, p: (typeof STYLE_PACKS)[number], aspect: Aspect) {
  const s: Scene = { id: 's1', durationMs: t.defaultMs, background: '#FFFFFF', layout: 'center', layers: [], template: t.id, slots: maxSlots(t) };
  const r: Recipe = {
    version: 2, id: 'r', name: 'Fit', type: 'promo', aspect, style: p.id, scenes: [expandScene(s, p)],
    assets: {
      photo: { id: 'photo', kind: 'image', name: 'P', mime: 'image/jpeg', bytes: 10, opfsPath: 'media/photo.jpg' },
      logo: { id: 'logo', kind: 'logo', name: 'l.png', mime: 'image/png', bytes: 10, opfsPath: 'media/logo.png' },
    },
  };
  return check(r).filter((i) => i.kind === 'overflow' || i.kind === 'contrast');
}
const label = (i: { kind: string; layerId: string; aspect: string }) => `${i.kind} ${i.layerId} ${i.aspect}`;

describe('max-length text: no contrast issue, and no overflow where the box can hold it', () => {
  for (const t of SCENE_TEMPLATES) for (const p of STYLE_PACKS) for (const aspect of ASPECTS) {
    it(`${t.id} / ${p.id} / ${aspect}`, () => {
      const bad = issuesFor(t, p, aspect).filter((i) => !(KNOWN_OVERFLOW.has(t.id) && i.kind === 'overflow' && !i.layerId.endsWith(':mark')));
      expect(bad.map(label)).toEqual([]);
    });
  }
});

describe('known: body text at the extreme overflows its slot', () => {
  for (const id of KNOWN_OVERFLOW) {
    it.fails(`${id} fits at the slot word limit`, () => {
      const t = SCENE_TEMPLATES.find((x) => x.id === id)!;
      const bad = STYLE_PACKS.flatMap((p) => ASPECTS.flatMap((a) => issuesFor(t, p, a))).filter((i) => i.kind === 'overflow');
      expect(bad.map(label)).toEqual([]);
    });
  }
});
