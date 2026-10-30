import { describe, expect, it } from 'vitest';
import { validateRecipe } from '../recipe/validate';
import type { Clip } from '../types';
import {
  addLayer, addScene, clock, clockShort, devSampleRecipe, findLayer, initState, newShape, newText, parseClock, reducer, removeLayer,
  sceneTitle, setAspect, setBox, setField, setTiming, type Action, type EditorState,
} from './store';

const clip = (): Clip => ({ id: 'c', recipe: devSampleRecipe('c'), history: [], createdAt: 0, updatedAt: 0 });
let n = 0;
const edit = (s: EditorState, e: { ops: never[] | unknown[]; summary: string; mergeKey?: string } | undefined, at = ++n * 10_000): EditorState =>
  reducer(s, { type: 'edit', edit: e as never, at, id: `x${at}` } as Action);

describe('editor store', () => {
  it('the dev sample is a valid recipe with 3 scenes and 10 layers', () => {
    const r = devSampleRecipe('c');
    expect(validateRecipe(r)).toEqual([]);
    expect(r.scenes.reduce((k, s) => k + s.layers.length, 0)).toBe(10);
    expect(sceneTitle(r.scenes[0]!)).toBe('Fresh sourdough');
  });

  it('starts on the first scene with its title selected', () => {
    const s = initState(clip());
    expect(s.sceneId).toBe('s1');
    expect(s.layerId).toBe('s1-title');
  });

  it('records hand edits and undoes and redoes them', () => {
    let s = initState(clip());
    const f = findLayer(s.clip.recipe, 's1', 's1-title')!;
    s = edit(s, setField(f, 'sizePx', 120, 'Title size 120'));
    s = edit(s, setBox(s.clip.recipe, findLayer(s.clip.recipe, 's1', 's1-title')!, { x: 0.1, y: 0.5, w: 0.8, h: 0.2 }, 'moved'));
    expect(s.clip.history.map((c) => c.by)).toEqual(['hand', 'hand']);
    s = reducer(s, { type: 'undo', at: 1 });
    s = reducer(s, { type: 'undo', at: 2 });
    expect(s.clip.recipe).toEqual(devSampleRecipe('c'));
    s = reducer(s, { type: 'redo', at: 3 });
    expect(findLayer(s.clip.recipe, 's1', 's1-title')!.layer).toMatchObject({ sizePx: 120 });
    expect(s.future).toHaveLength(1);
  });

  it('adds scenes, text and shapes, and drops the selection when an undo removes its layer', () => {
    let s = initState(clip());
    s = edit(s, addScene(s.clip.recipe, 's1', 'new'));
    expect(s.clip.recipe.scenes[1]!.id).toBe('new');
    const scene = s.clip.recipe.scenes[0]!;
    s = reducer(s, { type: 'edit', edit: addLayer(s.clip.recipe, 's1', newText(scene, 't1'))!, at: 1e9, id: 'a', select: { sceneId: 's1', layerId: 't1' } });
    s = edit(s, addLayer(s.clip.recipe, 's1', newShape(scene, 'sh1')));
    expect(validateRecipe(s.clip.recipe)).toEqual([]);
    expect(s.layerId).toBe('t1');
    s = reducer(s, { type: 'undo', at: 1 });
    s = reducer(s, { type: 'undo', at: 2 });
    expect(s.layerId).toBeUndefined();
    s = edit(s, removeLayer(findLayer(s.clip.recipe, 's1', 's1-card')!));
    expect(s.clip.recipe.scenes[0]!.layers.some((l) => l.id === 's1-card')).toBe(false);
  });

  it('switches size by reflowing boxes, and edits a "This size only" box in place', () => {
    let s = initState(clip());
    s = edit(s, setAspect(s.clip.recipe, '16:9'));
    expect(s.clip.recipe.aspect).toBe('16:9');
    expect(validateRecipe(s.clip.recipe)).toEqual([]);
    expect(setAspect(s.clip.recipe, '16:9')).toBeUndefined();
    const f = findLayer(s.clip.recipe, 's1', 's1-title')!;
    const own = { ...f, layer: { ...f.layer, boxes: { '16:9': f.layer.box } } };
    expect(setBox(s.clip.recipe, own, f.layer.box, 'moved').ops[0]!.path).toBe('/scenes/0/layers/2/boxes/16:9');
  });

  it('keeps timing inside the scene', () => {
    const s = initState(clip());
    const f = findLayer(s.clip.recipe, 's1', 's1-title')!;
    const e = setTiming(f, -50, 9000, 'Title')!;
    expect(e.ops.map((o) => (o as { value: number }).value)).toEqual([0, 5000]);
    expect(setTiming(f, 400, 4800, 'Title')).toBeUndefined();
  });

  it('ignores an edit that cannot apply', () => {
    const s = initState(clip());
    expect(edit(s, { ops: [{ op: 'replace', path: '/scenes/9/name', value: 1 }], summary: 'x' })).toBe(s);
  });

  it('formats and reads times as the frames show them', () => {
    expect(clock(1800)).toBe('0:01.8');
    expect(clock(15000)).toBe('0:15.0');
    expect(clockShort(10_000)).toBe('0:10');
    expect(parseClock('0:04.8')).toBe(4800);
    expect(parseClock('1:02')).toBe(62_000);
    expect(parseClock('soon')).toBeUndefined();
  });
});

describe('playhead', () => {
  it('selects the scene under the playhead', () => {
    let s = initState(clip());
    s = reducer(s, { type: 'time', ms: 7000 });
    expect(s.sceneId).toBe('s2');
    expect(s.layerId).toBeUndefined();
    s = reducer(s, { type: 'time', ms: 99_000 });
    expect(s.timeMs).toBe(15_000);
  });
});
