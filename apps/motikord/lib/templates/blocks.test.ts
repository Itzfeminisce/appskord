import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../checker';
import type { Aspect, Scene, SceneTemplate, SlotValue, TextLayer } from '../types';
import { planBlocks, polyHitsBox } from './blocks';
import { expandScene } from './expand';
import { SAFE_AREA, SCENE_TEMPLATES, STYLE_PACKS } from './scenes';

const ASPECTS: Aspect[] = ['9:16', '1:1', '16:9'];

function slotsFor(t: SceneTemplate, withMedia: boolean): Record<string, SlotValue> {
  const out: Record<string, SlotValue> = {};
  for (const d of t.slots) {
    const n = d.items?.[1] ?? 1;
    if (d.kind === 'text') out[d.id] = d.scale === 'number' ? '1,200' : 'people simple really better moment always'.split(' ').slice(0, d.words ?? 3).join(' ');
    else if (d.kind === 'items') out[d.id] = Array.from({ length: n }, () => 'simple words here');
    else if (d.kind === 'chart') out[d.id] = Array.from({ length: n }, (_, i) => ({ label: 'Mon', value: i + 1 }));
    else if (withMedia || d.kind === 'logo') out[d.id] = { assetId: d.kind === 'logo' ? 'logo' : 'photo' };
  }
  return out;
}

describe('no text slot sits on a contrasting background block', () => {
  for (const t of SCENE_TEMPLATES) for (const p of STYLE_PACKS) for (const withMedia of [false, true]) {
    it(`${t.id} / ${p.id}${withMedia ? ' / with media' : ''}`, () => {
      const s: Scene = { id: 's1', durationMs: t.defaultMs, background: '#FFFFFF', layout: 'center', layers: [], template: t.id, slots: slotsFor(t, withMedia) };
      const out = expandScene(s, p);
      const bg = out.bg!;
      if (bg.kind !== 'blocks') return;
      for (const aspect of ASPECTS) {
        const poly = bg.shapes?.[aspect];
        expect(poly, `${aspect} has a planned slab`).toBeDefined();
        const block = bg.colours[1]!;
        for (const l of out.layers) {
          if (l.type !== 'text' && l.type !== 'chart') continue;
          const ink = l.type === 'text' ? (l as TextLayer).colour : l.colour;
          if ((contrastRatio(ink, block) ?? 0) >= 3) continue;
          expect(polyHitsBox(poly!, l.boxes![aspect]!), `${l.id} ${aspect} sits on the block`).toBe(false);
        }
      }
    });
  }
});

describe('planBlocks', () => {
  it('keeps the pack band when the text leaves room', () => {
    const plan = planBlocks([{ x: 0.07, y: 0.2, w: 0.86, h: 0.3 }], '9:16', SAFE_AREA['9:16'])!;
    expect(plan.squeeze).toBeUndefined();
    expect(Math.min(...plan.shape.map((pt) => pt[1]))).toBeCloseTo(0.7);
  });
  it('squeezes full-width text beside the 1:1 panel', () => {
    const plan = planBlocks([{ x: 0.06, y: 0.06, w: 0.88, h: 0.88 }], '1:1', SAFE_AREA['1:1'])!;
    expect(plan.squeeze?.axis).toBe('x');
    expect(plan.squeeze!.to[1]).toBeLessThanOrEqual(0.65);
  });
  it('finds no overlap between a box and a polygon apart from it', () => {
    expect(polyHitsBox([[0, 0.7], [1, 0.6], [1, 1], [0, 1]], { x: 0.1, y: 0.1, w: 0.8, h: 0.45 })).toBe(false);
    expect(polyHitsBox([[0, 0.7], [1, 0.6], [1, 1], [0, 1]], { x: 0.8, y: 0.5, w: 0.15, h: 0.15 })).toBe(true);
  });
});
