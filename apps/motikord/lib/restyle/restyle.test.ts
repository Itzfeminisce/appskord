import { describe, expect, it } from 'vitest';
import { expandScene, getPack } from '@appskord/scenes';
import type { Scene } from '@appskord/scenes';
import { validateClip } from '@appskord/motion/recipe';
import { TEMPLATES_V3 } from '../templates/v3/templates';
import type { Asset, Clip, Recipe } from '../types';
import { clipMediaIds, clipWords, isRestyled, openV2Version, restyle, RESTYLE } from './restyle';

const asset = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/png', bytes: 1, opfsPath: `media/${id}` });

/** A v2 Bold clip: every template filled with the frame's words, media in the media slots, plus a hand-made scene. */
function v2Clip(): Clip {
  const bold = getPack('bold')!;
  const scenes: Scene[] = TEMPLATES_V3.map((t, i) => {
    const slots = { ...t.sample };
    if (t.id === 'hero' || t.id === 'split') slots.media = { assetId: `img-${t.id}` };
    if (t.id === 'before-after') Object.assign(slots, { beforeMedia: { assetId: 'img-b' }, afterMedia: { assetId: 'img-a' } });
    const scene: Scene = { id: `sc${i}`, durationMs: 3000, background: '#0A0A0A', layout: 'center', layers: [], template: t.id, slots };
    return expandScene(scene, bold);
  });
  scenes.push({
    id: 'free',
    durationMs: 2000,
    background: '#FFFFFF',
    layout: 'center',
    layers: [
      { id: 't1', name: 'Title', type: 'text', role: 'title', text: 'Stop scrolling', font: 'Geist', sizePx: 100, weight: 800, colour: '#111114', align: 'center', lineHeight: 1.1, startMs: 0, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 0.2 }, opacity: 1 },
      { id: 'v1', name: 'Clip', type: 'video', assetId: 'vid-1', fit: 'cover', startMs: 0, endMs: 2000, box: { x: 0, y: 0, w: 1, h: 1 }, opacity: 1 },
    ],
  });
  const ids = ['img-hero', 'img-split', 'img-b', 'img-a', 'vid-1'];
  const recipe: Recipe = { version: 2, id: 'c1', name: 'Morning shift', type: 'promo', aspect: '9:16', style: 'bold', scenes, assets: Object.fromEntries(ids.map((id) => [id, asset(id)])) };
  return { id: 'c1', recipe, history: [], createdAt: 1, updatedAt: 1 };
}

describe('restyle with v3 motion', () => {
  it('keeps every word, scene, timing and media id, keeps Bold, and the result validates', () => {
    const before = v2Clip();
    const words = clipWords(before.recipe);
    expect(words).toContain('Try Fieldnote free today');
    const media = clipMediaIds(before.recipe);
    const after = restyle(before, { now: 5, changeId: 'ch1' });
    expect(validateClip(after.v3)).toEqual({ ok: true, value: after.v3 });
    expect(after.v3.packId).toBe('bold');
    expect(after.v3.restyledFrom).toBe('c1');
    expect(clipWords(after.recipe)).toEqual(words);
    expect(clipMediaIds(after.recipe)).toEqual(media);
    expect(after.v3.scenes.map((s) => [s.id, s.ms])).toEqual(before.recipe.scenes.map((s) => [s.id, s.durationMs]));
    // every v2 layer (its words or media) is drawn by a v3 layer of the same id
    for (const [i, s] of before.recipe.scenes.entries()) {
      const v3ids = after.v3.scenes[i]!.layers.map((l) => l.id);
      for (const l of s.layers) expect(v3ids, `${s.id} ${l.id}`).toContain(l.id);
    }
    expect(after.v3.scenes.at(-1)!.templateId).toBe('free');
  });

  it('records the v2 version in Changes and opens it unchanged (round trip)', () => {
    const before = v2Clip();
    const after = restyle(before, { packId: 'soft', keyFramesFirst: true, fps: 60, now: 5, changeId: 'ch1' });
    expect(isRestyled(after)).toBe(true);
    expect(after.history.at(-1)).toMatchObject({ id: 'ch1', by: 'hand', summary: 'Restyled with v3 motion · Soft' });
    expect(after.v3.scenes.every((s) => s.keyFrameApproved === false)).toBe(true);
    expect(after.v3.fps).toBe(60);
    const back = openV2Version(after);
    expect(isRestyled(back)).toBe(false);
    expect(back.recipe).toEqual(before.recipe);
    expect(clipWords(back.recipe)).toEqual(clipWords(before.recipe));
    expect(clipMediaIds(back.recipe)).toEqual(clipMediaIds(before.recipe));
    expect(RESTYLE.open).toBe('Open v2 version');
  });

  it('restyles into every pack', () => {
    for (const packId of ['clean', 'bold', 'playful', 'corporate', 'studio', 'kinetic', 'gloss', 'soft'] as const) {
      const r = validateClip(restyle(v2Clip(), { packId, now: 1, changeId: 'x' }).v3);
      expect(r.ok ? [] : r.errors, packId).toEqual([]);
    }
  });
});

describe('restyling again and timing', () => {
  it('undoes a second restyle with a replace of the previous v3, and Open v2 drops restyle Changes', () => {
    const first = restyle(v2Clip(), { packId: 'bold', now: 5, changeId: 'ch1' });
    const second = restyle(first, { packId: 'soft', now: 6, changeId: 'ch2' });
    const change = second.history.at(-1)!;
    expect(change.patch[0]).toMatchObject({ op: 'replace', path: '/v3' });
    expect(change.inverse).toEqual([{ op: 'replace', path: '/v3', value: first.v3 }]);
    expect(second.v2Version).toEqual(first.v2Version);
    const back = openV2Version(second);
    expect(back.history).toEqual([]);
    expect(back.recipe).toEqual(v2Clip().recipe);
  });

  it('keeps a custom-timed v2 layer: starts where it started and its tracks fit its length', () => {
    const clip = v2Clip();
    const free = clip.recipe.scenes.at(-1)!;
    Object.assign(free.layers[0]!, { startMs: 500, endMs: 800 });
    const after = restyle(clip, { now: 1, changeId: 'x' });
    const layers = after.v3.scenes.at(-1)!.layers;
    const timed = layers.find((l) => l.id === 't1')!;
    expect(timed.start).toBe(500);
    const ends = Object.values(timed.tracks).map((t) => t.at(-1)!.t);
    expect(Math.max(...ends)).toBe(300);
    // a layer spanning the whole scene keeps the template's own timing
    expect(layers.find((l) => l.id === 'v1')!.start).not.toBe(0 + 99999);
    expect(validateClip(after.v3).ok).toBe(true);
  });
});

