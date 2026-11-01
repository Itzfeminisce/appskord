import { describe, expect, it } from 'vitest';
import { check } from '../checker';
import { applyPatch } from '../patch';
import { LAYOUTS, safeBox, insideSafe } from '../render/reflow';
import type { Recipe, TextLayer } from '../types';
import { layoutBoxes } from './arrange';
import { devSampleRecipe, setLayout } from './store';

const apply = (r: Recipe, si: number, id: string) => applyPatch(r, setLayout(r, si, id, id)!.ops).doc;

describe('layoutBoxes', () => {
  const r = devSampleRecipe('a');
  it('stacks text title above body above caption inside the safe area', () => {
    for (const id of LAYOUTS) {
      const m = layoutBoxes(r, r.scenes[0]!, id);
      const t = m.get('s1-title')!;
      const b = m.get('s1-sub')!;
      expect(t.y + t.h).toBeLessThanOrEqual(b.y + 1e-6);
      expect(insideSafe(t, '9:16')).toBe(true);
      expect(insideSafe(b, '9:16')).toBe(true);
    }
  });
  it('puts the circle (media-like) and text in different halves for top and bottom', () => {
    const top = layoutBoxes(r, r.scenes[1]!, 'top');
    expect(top.get('s2-dot')!.y + top.get('s2-dot')!.h).toBeLessThanOrEqual(0.5);
    expect(top.get('s2-title')!.y).toBeGreaterThanOrEqual(0.5);
    const bottom = layoutBoxes(r, r.scenes[1]!, 'bottom');
    expect(bottom.get('s2-dot')!.y).toBeGreaterThanOrEqual(0.5);
    expect(bottom.get('s2-title')!.y + bottom.get('s2-title')!.h).toBeLessThanOrEqual(0.5);
  });
  it('lower third keeps text in the bottom third, full puts text over a full picture', () => {
    const lt = layoutBoxes(r, r.scenes[1]!, 'lower-third');
    expect(lt.get('s2-title')!.y).toBeGreaterThanOrEqual(0.55);
    const full = layoutBoxes(r, r.scenes[1]!, 'full');
    expect(full.get('s2-dot')).toBeDefined();
  });
  it('leaves locked layers alone and drops per-size boxes of moved layers as one change', () => {
    const base = structuredClone(r);
    const l0 = base.scenes[0]!.layers;
    l0[0]!.locked = true;
    (l0[2] as TextLayer).boxes = { '1:1': { x: 0.1, y: 0.1, w: 0.5, h: 0.2 } };
    expect(layoutBoxes(base, base.scenes[0]!, 'top').has('s1-card')).toBe(false);
    const e = setLayout(base, 0, 'top', 'Photo on top')!;
    expect(e.summary).toBe('Layout Photo on top');
    const doc = applyPatch(base, e.ops).doc;
    expect(doc.scenes[0]!.layers[2]!.boxes).toBeUndefined();
    expect(doc.scenes[0]!.layers[0]!.box).toEqual(base.scenes[0]!.layers[0]!.box);
    expect(doc.scenes[0]!.layers.map((l) => l.id)).toEqual(base.scenes[0]!.layers.map((l) => l.id));
  });
  it('wide split sets media and text side by side', () => {
    const w = { ...structuredClone(r), aspect: '16:9' as const };
    const m = layoutBoxes(w, w.scenes[1]!, 'split');
    expect(m.get('s2-title')!.x).toBeGreaterThanOrEqual(0.5);
    expect(m.get('s2-dot')!.x + m.get('s2-dot')!.w).toBeLessThanOrEqual(0.5);
  });
  it('the checker finds no overflow or safe-area issue on the sample clip for all six', () => {
    for (const id of LAYOUTS) {
      let doc = structuredClone(r);
      doc.scenes.forEach((s) => { s.layout = 'x'; });
      for (let si = 0; si < doc.scenes.length; si++) doc = apply(doc, si, id);
      const bad = check(doc).filter((i) => i.kind === 'overflow' || i.kind === 'safe-area');
      expect(bad.map((i) => i.id), id).toEqual([]);
      expect(safeBox('9:16').w).toBeGreaterThan(0);
    }
  });
});
