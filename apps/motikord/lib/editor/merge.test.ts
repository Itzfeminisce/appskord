import { describe, expect, it } from 'vitest';
import type { Clip } from '../types';
import { mergeClip, sameVersion } from './merge';
import { findLayer, initState, reducer, rename, setField, devSampleRecipe, type EditorState, type Edit } from './store';

const stored0 = (): Clip => ({ id: 'c', recipe: devSampleRecipe('c'), history: [], createdAt: 0, updatedAt: 1 });
let n = 0;
const edit = (s: EditorState, e: Edit) => reducer(s, { type: 'edit', edit: e, at: (++n) * 10_000, id: `e${n}` });
const title = (s: EditorState) => findLayer(s.clip.recipe, 's1', 's1-title')!;
const titleText = (c: Clip) => findLayer(c.recipe, 's1', 's1-title')!.layer;

describe('merging what another surface saved', () => {
  it('keeps the editor clip when the store has not changed', () => {
    const base = stored0();
    const s = edit(initState(base), setField(title(initState(base)), 'text', 'Hi', 'Text changed'));
    const out = mergeClip(s.clip, base, structuredClone(base));
    expect(out.clip).toBe(s.clip);
    expect(out.dirty).toBe(true);
    expect(sameVersion(base, structuredClone(base))).toBe(true);
  });

  it('takes a Library rename and keeps unsaved hand edits', () => {
    const base = stored0();
    const s = edit(initState(base), setField(title(initState(base)), 'text', 'Hi', 'Text changed'));
    const renamed: Clip = { ...structuredClone(base), recipe: { ...structuredClone(base.recipe), name: 'From the Library' }, updatedAt: 5 };
    const out = mergeClip(s.clip, base, renamed, 9);
    expect(out.clip.recipe.name).toBe('From the Library');
    expect((titleText(out.clip) as { text: string }).text).toBe('Hi');
    expect(out.clip.history.map((c) => c.summary)).toEqual(['Text changed']);
    expect(out.dirty).toBe(true);
  });

  it('keeps the editor’s own rename over the stored name', () => {
    const base = stored0();
    const s = edit(initState(base), rename(base.recipe, 'Mine'));
    const renamed: Clip = { ...structuredClone(base), recipe: { ...structuredClone(base.recipe), name: 'Theirs' }, updatedAt: 5 };
    expect(mergeClip(s.clip, base, renamed).clip.recipe.name).toBe('Mine');
  });

  it('adopts a stored change (brand apply) when nothing is unsaved, without marking it dirty', () => {
    const base = stored0();
    const s = initState(base);
    const branded = edit(initState(structuredClone(base)), setField(title(s), 'colour', '#BE185D', 'Brand kit')).clip;
    const out = mergeClip(s.clip, base, { ...branded, updatedAt: 7 });
    expect(out.dirty).toBe(false);
    expect((titleText(out.clip) as { colour: string }).colour).toBe('#BE185D');
    expect(out.clip.updatedAt).toBe(7);
  });

  it('takes back a saved change the editor undid', () => {
    const base0 = stored0();
    const s1 = edit(initState(base0), setField(title(initState(base0)), 'text', 'Saved', 'Text changed'));
    const base = { ...s1.clip, updatedAt: 3 };
    const undone = reducer({ ...s1, clip: base }, { type: 'undo', at: 1 });
    const theirs: Clip = { ...structuredClone(base), recipe: { ...structuredClone(base.recipe), name: 'Renamed' }, updatedAt: 6 };
    const out = mergeClip(undone.clip, base, theirs);
    expect((titleText(out.clip) as { text: string }).text).toBe('Fresh sourdough');
    expect(out.clip.history).toHaveLength(0);
    expect(out.clip.recipe.name).toBe('Renamed');
  });

  it('drops an edit whose layer the stored clip no longer has', () => {
    const base = stored0();
    const s = edit(initState(base), setField(title(initState(base)), 'text', 'Hi', 'Text changed'));
    const fewer = structuredClone(base);
    fewer.recipe.scenes[0]!.layers = [];
    const out = mergeClip(s.clip, base, { ...fewer, updatedAt: 4 });
    expect(out.clip.history).toHaveLength(0);
    expect(out.dirty).toBe(false);
  });
});
