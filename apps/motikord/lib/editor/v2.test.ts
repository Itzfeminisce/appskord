import { describe, expect, it } from 'vitest';
import { applyPatch } from '../patch';
import { expandScene } from '../templates/expand';
import { getPack } from '../templates/scenes';
import type { Clip, Recipe, Scene, SlotValue, TemplateId } from '../types';
import { initState, reducer, type EditorState, type Edit } from './store';
import {
  isV1Clip, nearestTemplate, newLook, noOtherFit, originalOf, overflowAt, pourSlots, remakeEdit, setSlot, setTransition, slotCount, swapGroups,
  swapTemplate, transitionGroups, transitionLabel,
} from './v2';
import { getSceneTemplate } from '../templates/scenes';

const pack = getPack('bold')!;
const scene = (id: string, template: TemplateId, slots: Record<string, SlotValue>): Scene =>
  expandScene({ id, durationMs: 3000, background: '#000', layout: 'center', layers: [], template, slots }, pack);

function recipe(): Recipe {
  return {
    version: 2, id: 'r', name: 'Rise', type: 'promo', aspect: '9:16', assets: {}, style: 'bold', pace: 'normal',
    scenes: [
      scene('a', 'title-hook', { kicker: 'Rise bakery', headline: 'Fresh sourdough daily' }),
      scene('b', 'list', { title: 'In the case today', items: ['Rye', 'Spelt', 'Seeded', 'Plain'] }),
      { ...scene('c', 'stat-reveal', { number: '1,200', label: 'loaves a week' }), transition: { kind: 'push', ms: 300 } },
    ],
  };
}
const clip = (r: Recipe): Clip => ({ id: 'c', recipe: r, history: [], createdAt: 0, updatedAt: 0 });
const edit = (s: EditorState, e: Edit | undefined, by: 'hand' | 'groq' = 'hand') => reducer(s, { type: 'edit', edit: e!, by, at: 1, id: String(Math.random()) });
const undo = (s: EditorState) => reducer(s, { type: 'undo', at: 2 });

describe('slots', () => {
  it('counts words against the limit', () => {
    const def = getSceneTemplate('title-hook')!.slots.find((d) => d.id === 'headline')!;
    expect(slotCount(def, 'Fresh sourdough')).toEqual({ n: 2, limit: 6, over: false });
    expect(slotCount(def, 'one two three four five six seven').over).toBe(true);
  });

  it('shortens over-limit text, keeps the original for Show original, and undoes in one step', () => {
    const r = recipe();
    const long = 'Fresh sourdough baked every single morning at five';
    const out = setSlot(r, 0, 'headline', long)!;
    expect(out.shortened).toBe(true);
    expect(out.edit.summary).toBe('Scene 1 headline shortened to fit');
    let s = edit(initState(clip(r)), out.edit);
    const sc = s.clip.recipe.scenes[0]!;
    expect(sc.slots!.headline).toBe('Fresh sourdough baked every single morning');
    expect(originalOf(sc, 'headline')).toBe(long);
    s = undo(s);
    expect(s.clip.recipe.scenes[0]!.slots!.headline).toBe('Fresh sourdough daily');
    expect(s.clip.recipe.scenes[0]!.original).toBeUndefined();
  });

  it('typing within the limit is not shortened', () => {
    const out = setSlot(recipe(), 0, 'headline', 'Fresh rye')!;
    expect(out.shortened).toBe(false);
    expect(out.edit.mergeKey).toBe('a/slot/headline');
  });
});

describe('swap template', () => {
  it('keeps the words when they fit', () => {
    const r = recipe();
    expect(swapGroups(r.scenes[1]!).fits[0]).toBe('list');

    // List has 4 items; Steps takes exactly 3, so steps is not a whole fit.
    expect(pourSlots(r.scenes[1]!, 'steps', true)).toBeUndefined();
    const big = swapTemplate(r, 0, 'big-statement')!;
    expect(big.edit.summary).toBe('Scene 1 template: Title hook → Big statement');
    const next = applyPatch(r, big.edit.ops).doc.scenes[0]!;
    expect(next.template).toBe('big-statement');
    expect(next.slots!.statement).toContain('Rise bakery');
    expect(next.slots!.statement).toContain('Fresh sourdough daily');
  });

  it('moves list items into another items slot unchanged', () => {
    const r = recipe();
    r.scenes[1] = scene('b', 'list', { title: 'How we bake', items: ['Mix', 'Proof', 'Bake'] });
    const out = swapTemplate(r, 1, 'steps')!;
    const next = applyPatch(r, out.edit.ops).doc.scenes[1]!;
    expect(next.slots).toEqual({ title: 'How we bake', steps: ['Mix', 'Proof', 'Bake'] });
    expect(out.shortened).toBe(false);
    expect(out.edit.summary).toBe('Scene 2 template: List → Steps');
  });

  it('shortens what does not fit an other template, with the original kept', () => {
    const r = recipe();
    const out = swapTemplate(r, 1, 'stat-reveal')!;
    const next = applyPatch(r, out.edit.ops).doc.scenes[1]!;
    expect(next.template).toBe('stat-reveal');
    expect(out.shortened).toBe(true);
    expect(next.original).toBeDefined();
  });

  it('counts a template as a fit when the joined words stay within its limit, so swap-no-fit is not shown', () => {
    const hook = scene('h', 'title-hook', { kicker: 'New release', headline: 'Meet the faster way to ship' });
    expect(swapGroups(hook).fits).toContain('big-statement');
    expect(noOtherFit(hook)).toBe(false);
    expect(pourSlots(hook, 'big-statement', true)).toEqual({ statement: 'New release. Meet the faster way to ship' });
    const stat = scene('s', 'stat-reveal', { number: '1,200', label: 'loaves a week', source: 'Since 2019' });
    expect(swapGroups(stat).fits).toContain('big-statement');
  });

  it('reports swap-no-fit when only the current template fits', () => {
    const lone = scene('x', 'quote', { quote: 'The best bread I have had in years, and I have had a lot of bread', name: 'Ada', role: 'Regular' });
    expect(noOtherFit(lone)).toBe(true);
  });
});

describe('remake', () => {
  it('replaces only that scene and undoes back', () => {
    const r = recipe();
    const after = { ...r, scenes: r.scenes.map((s) => (s.id === 'b' ? scene('b', 'list', { title: 'Today', items: ['Rye', 'Spelt', 'Seeded'] }) : s)) };
    const e = remakeEdit(r, 'b', after)!;
    expect(e.summary).toBe('Scene 2 remade');
    let s = edit(initState(clip(r)), e, 'groq');
    expect(s.clip.recipe.scenes[1]!.slots!.title).toBe('Today');
    expect(s.clip.recipe.scenes[0]).toEqual(r.scenes[0]);
    s = undo(s);
    expect(s.clip.recipe).toEqual(r);
  });
});

describe('new look', () => {
  it('restyles with the same slots, in one undoable change', () => {
    const r = recipe();
    const e = newLook(r, 'playful', 'calm');
    expect(e.summary).toBe('New look: Playful');
    let s = edit(initState(clip(r)), e);
    const after = s.clip.recipe;
    expect(after.style).toBe('playful');
    expect(after.pace).toBe('calm');
    after.scenes.forEach((sc, i) => expect(sc.slots).toEqual(r.scenes[i]!.slots));
    expect(after.scenes[1]!.transition?.kind).toBe('zoom');
    s = undo(s);
    expect(s.clip.recipe).toEqual(r);
  });

  it('turns a v1 clip of free layers into templates, words kept', () => {
    const t = (id: string, text: string, role: 'title' | 'body', sizePx: number) => ({
      id, name: id, type: 'text' as const, role, text, font: 'Geist', sizePx, weight: 600, colour: '#000', align: 'left' as const,
      lineHeight: 1.2, startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: sizePx === 96 ? 0.2 : 0.5, w: 1, h: 0.1 },
    });
    const v1: Recipe = {
      version: 1, id: 'v', name: 'Old', type: 'promo', aspect: '9:16', assets: {},
      scenes: [
        { id: 's1', durationMs: 3000, background: '#fff', layout: 'center', layers: [t('a', 'Fresh sourdough', 'title', 96), t('b', 'Slow fermented', 'body', 40)] },
        { id: 's2', durationMs: 3000, background: '#fff', layout: 'center', layers: [t('c', '1,200', 'title', 96), t('d', 'loaves a week', 'body', 40)] },
      ],
    };
    expect(isV1Clip(v1)).toBe(true);
    expect(nearestTemplate(v1.scenes[0]!)?.template).toBe('title-hook');
    const next = applyPatch(v1, newLook(v1, 'clean', 'normal').ops).doc;
    expect(next.version).toBe(2);
    expect(next.scenes.map((s) => s.template)).toEqual(['title-hook', 'stat-reveal']);
    expect(next.scenes[0]!.slots).toEqual({ headline: 'Fresh sourdough', kicker: 'Slow fermented' });
    expect(isV1Clip(next)).toBe(false);
  });
});

describe('free-layer scenes', () => {
  const t = (id: string, text: string) => ({
    id, name: id, type: 'text' as const, role: 'title' as const, text, font: 'Geist', sizePx: 60, weight: 600, colour: '#000', align: 'left' as const,
    lineHeight: 1.2, startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: 0.2, w: 1, h: 0.1 },
  });
  const img = (id: string, assetId: string) => ({ id, name: id, type: 'image' as const, assetId, fit: 'cover' as const, startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 0.5 } });
  const free = (layers: unknown[]): Scene => ({ id: 'f', durationMs: 3000, background: '#fff', layout: 'center', layers } as unknown as Scene);

  it('pours a free-layer scene into another template, so Swap template works on v1 scenes', () => {
    const scene = free([t('a', 'Fresh sourdough'), t('b', 'Slow fermented')]);
    const slots = pourSlots(scene, 'big-statement', false);
    expect(slots).toBeDefined();
    expect(JSON.stringify(slots)).toContain('Fresh sourdough');
    expect(swapGroups(scene).fits.length).toBeGreaterThan(0);
  });

  it('keeps a second image in a template with two media slots', () => {
    const near = nearestTemplate(free([img('p', 'one'), img('q', 'two'), t('a', 'Before'), t('b', 'After')]));
    expect(near?.template).toBe('before-after');
    expect(near?.slots).toMatchObject({ beforeMedia: { assetId: 'one' }, afterMedia: { assetId: 'two' }, before: 'Before', after: 'After' });
  });

  it('leaves a scene of shapes alone as free layers', () => {
    expect(nearestTemplate(free([{ id: 's', type: 'shape' }]))).toBeUndefined();
  });
});

describe('transitions', () => {
  it('sets the transition into a scene and undoes it', () => {
    const r = recipe();
    const e = setTransition(r, 1, { kind: 'wipe', ms: 500 })!;
    expect(e.summary).toBe('Transition into scene 2: Wipe · 0.5 s');
    let s = edit(initState(clip(r)), e);
    expect(s.clip.recipe.scenes[1]!.transition).toEqual({ kind: 'wipe', ms: 500 });
    s = undo(s);
    expect(s.clip.recipe.scenes[1]!.transition).toBeUndefined();
  });

  it('uses one transition for every cut and clamps the length', () => {
    const r = recipe();
    const next = applyPatch(r, setTransition(r, 2, { kind: 'zoom', ms: 5000 }, true)!.ops).doc;
    expect(next.scenes.map((s) => s.transition)).toEqual([undefined, { kind: 'zoom', ms: 1000 }, { kind: 'zoom', ms: 1000 }]);
    expect(transitionLabel({ kind: 'push', ms: 300 })).toBe('Push · 0.3 s');
    expect(transitionGroups(pack).pack).toEqual(pack.transitions);
  });
});

describe('slot overflow', () => {
  it('finds where the words past the limit start', () => {
    expect(overflowAt('Fresh sourdough every single morning here now', 6)).toBe('Fresh sourdough every single morning here '.length);
    expect(overflowAt('  Fresh  bread ', 1)).toBe('  Fresh  '.length);
    expect(overflowAt('Fresh bread', 6)).toBeUndefined();
    expect(overflowAt('Fresh bread', undefined)).toBeUndefined();
  });
});
