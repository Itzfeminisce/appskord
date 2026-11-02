import { describe, expect, it } from 'vitest';
import { check } from '../checker';
import { applyPatch } from '../patch';
import { expandScene } from '../templates/expand';
import { getPack, getSceneTemplate } from '../templates/scenes';
import type { Layer, Recipe, Scene, SlotValue, TemplateId } from '../types';
import { autoFixEdits, fixedLine, layoutText, repeatRun, toLookAt } from './checks';
import { initState, reducer } from './store';

const measure = (t: string, s: number) => t.length * s * 0.5;
const txt = (id: string, box: { x: number; y: number; w: number; h: number }, extra: Partial<Layer> = {}): Layer => ({
  id, name: id, type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 80, weight: 700, colour: '#FFFFFF',
  align: 'center', lineHeight: 1.2, startMs: 0, endMs: 3000, opacity: 1, box, ...extra,
} as Layer);
const free = (layers: Layer[]): Scene => ({ id: 's1', durationMs: 3000, background: '#111114', layout: 'center', layers });
const tpl = (id: string, t: TemplateId, slots: Record<string, SlotValue>): Scene =>
  expandScene({ id, durationMs: getSceneTemplate(t)!.defaultMs, background: '#fff', layout: 'center', layers: [], template: t, slots }, getPack('clean')!);
const v2 = (scenes: Scene[], extra: Partial<Recipe> = {}): Recipe => ({
  version: 2, id: 'r', name: 'Clip', type: 'promo', aspect: '9:16', style: 'clean', scenes,
  assets: { logo: { id: 'logo', kind: 'logo', name: 'l', mime: 'image/png', bytes: 1, opfsPath: 'l' } }, ...extra,
});
const first = (r: Recipe, kind: string) => check(r, { measure }).find((i) => i.kind === kind)!;
const card = (r: Recipe, kind: string) => {
  const i = first(r, kind);
  return { i, t: layoutText(i.kind, r, i.sceneId, i.layerId, i.aspect, i.fix, i.note)! };
};
const clears = (r: Recipe, kind: string) => {
  const i = first(r, kind);
  const after = applyPatch(r, i.fix).doc;
  return !check(after, { measure }).some((x) => x.id === i.id);
};

describe('checker v2 cards', () => {
  it('overlap: "Logo overlaps the head", Move logo clears it', () => {
    const logo = { id: 'mark', name: 'Logo', type: 'image', assetId: 'logo', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0.12, y: 0.12, w: 0.2, h: 0.1 } } as Layer;
    const r = v2([free([txt('head', { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }), logo])]);
    expect(card(r, 'overlap').t).toMatchObject({ title: 'Logo overlaps the head', action: 'Move logo' });
    expect(clears(r, 'overlap')).toBe(true);
  });

  it('crowding: names the line it drops, and dropping it clears the card', () => {
    const rows = [0.1, 0.25, 0.4, 0.55].map((y, i) => txt(`t${i}`, { x: 0.1, y, w: 0.5, h: 0.08 }, { text: `Line ${i}` }));
    const r = v2([free(rows)], { aspect: '1:1' });
    expect(card(r, 'crowding').t).toEqual({ title: 'Scene 1 is crowded', body: 'Four lines in a small space.', action: 'Drop the fourth line' });
    expect(clears(r, 'crowding')).toBe(true);
  });

  it('empty: "Scene 1 is mostly empty at 16:9", Use the 16:9 layout clears it', () => {
    const s = tpl('s1', 'big-statement', { statement: 'Fresh bread every day' });
    s.layers = s.layers.map((l) => ({ ...l, boxes: { ...l.boxes, '16:9': { x: 0.4, y: 0.45, w: 0.2, h: 0.1 } } }));
    const r = v2([s]);
    expect(card(r, 'empty').t).toEqual({ title: 'Scene 1 is mostly empty at 16:9', body: 'Both sides of the frame are bare.', action: 'Use the 16:9 layout' });
    expect(clears(r, 'empty')).toBe(true);
  });

  it('align: "Name and role don\'t line up", Align left clears it', () => {
    const r = v2([free([txt('Name', { x: 0.2, y: 0.2, w: 0.5, h: 0.1 }, { align: 'left' }), txt('Role', { x: 0.21, y: 0.4, w: 0.3, h: 0.1 }, { align: 'left' })])], { aspect: '1:1' });
    const { t } = card(r, 'align');
    expect(t.title).toBe("Name and role don't line up");
    expect(t.body).toMatch(/^The role starts \d+ px further right\.$/);
    expect(t.action).toBe('Align left');
    expect(clears(r, 'align')).toBe(true);
  });

  it('words: shortening clears it, and the fixed line names the slot and its limit', () => {
    const s = tpl('s1', 'title-hook', { kicker: 'Rise', headline: 'Short' });
    s.slots = { ...s.slots, headline: 'one two three four five six seven eight nine' };
    const r = v2([s]);
    const i = first(r, 'words');
    expect(layoutText(i.kind, r, i.sceneId, i.layerId, i.aspect, i.fix, i.note)!.action).toBe('Shorten now');
    expect(clears(r, 'words')).toBe(true);
    expect(fixedLine(i, r)).toBe('Scene 1 headline cut to 6 words\nWas 9 words. The slot holds 6.');
  });

  it('template-repeat: names the run, and its swap clears it', () => {
    const items = ['One two', 'Three four', 'Five six'];
    const r = v2(['a', 'b', 'c'].map((n) => tpl(n, 'list', { title: 'Our steps', items })));
    expect(repeatRun(r, 'c')).toEqual({ scenes: [1, 2, 3], template: 'List' });
    expect(clears(r, 'template-repeat')).toBe(true);
  });

  it('Check again records each automatic fix as its own Change, each one undoable', () => {
    const items = ['One two', 'Three four', 'Five six'];
    const r = v2(['a', 'b', 'c'].map((n) => tpl(n, 'list', { title: 'Our steps', items })));
    const edits = autoFixEdits(r, { measure });
    expect(edits.map((e) => e.summary)).toContain('Scene 3 swapped from List to Steps\nIts items read as steps.');
    let s = initState({ id: 'c', recipe: r, history: [], createdAt: 0, updatedAt: 0 });
    edits.forEach((e, k) => { s = reducer(s, { type: 'edit', edit: e, by: 'check', at: k, id: `f${k}` }); });
    expect(s.clip.history.every((c) => c.by === 'check')).toBe(true);
    expect(s.clip.recipe.scenes[2]!.template).toBe('steps');
    for (let k = 0; k < edits.length; k++) s = reducer(s, { type: 'undo', at: 99 });
    expect(s.clip.recipe).toEqual(r);
  });
});

describe('toLookAt', () => {
  it('counts layout cards plus critic notes on scenes that still exist, as the Check badge and panel headline show', () => {
    const r = v2([free([]), { ...free([]), id: 's2' }, { ...free([]), id: 's3' }]);
    const note = (sceneIndex: number) => ({ sceneIndex, problem: 'p', fix: 'f' });
    expect(toLookAt(3, [note(2)], r)).toBe(4);
    expect(toLookAt(3, [note(2), note(5)], r)).toBe(4);
    expect(toLookAt(0, [], r)).toBe(0);
  });
});
