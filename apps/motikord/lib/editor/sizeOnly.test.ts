import { describe, expect, it } from 'vitest';
import { applyPatch } from '../patch';
import { boxFor } from '../render/reflow';
import { validateRecipe } from '../recipe/validate';
import { devSampleRecipe, findLayer, setBox, setField } from './store';
import { toSizeOnly, touchesBox } from './sizeOnly';

describe('this size only', () => {
  it('writes a moved box to boxes[aspect] and leaves the other sizes alone', () => {
    const r = { ...devSampleRecipe('s'), aspect: '1:1' as const };
    const f = findLayer(r, 's1', 's1-title')!;
    const box = { x: 0.2, y: 0.3, w: 0.5, h: 0.2 };
    const e = toSizeOnly(r, setBox(r, f, box, 'moved'));
    expect(e.summary).toBe('Title moved (1:1)');
    const next = applyPatch(r, e.ops).doc;
    const l = next.scenes[0]!.layers[2]!;
    expect(l.box).toEqual(f.layer.box);
    expect(l.boxes).toEqual({ '1:1': box });
    expect(boxFor(l, '1:1', '1:1')).toEqual(box);
    expect(boxFor(l, '9:16', '1:1')).toEqual(boxFor(f.layer, '9:16', '1:1'));
    expect(validateRecipe(next)).toEqual([]);

    // The next edit replaces that size's box in place.
    const f2 = findLayer(next, 's1', 's1-title')!;
    const again = toSizeOnly(next, setBox(next, f2, { ...box, x: 0.1 }, 'moved'));
    expect(again.ops).toEqual([{ op: 'replace', path: '/scenes/0/layers/2/boxes/1:1', value: { ...box, x: 0.1 } }]);
  });

  it('adds a size to boxes that already holds another', () => {
    const base = devSampleRecipe('s');
    const r = applyPatch(base, [{ op: 'add', path: '/scenes/0/layers/2/boxes', value: { '16:9': { x: 0, y: 0, w: 1, h: 1 } } }]).doc;
    const e = toSizeOnly(r, { ops: [{ op: 'replace', path: '/scenes/0/layers/2/box', value: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }], summary: 'Title moved' });
    expect(e.ops[0]).toMatchObject({ op: 'add', path: '/scenes/0/layers/2/boxes/9:16' });
    expect(Object.keys(applyPatch(r, e.ops).doc.scenes[0]!.layers[2]!.boxes!)).toEqual(['16:9', '9:16']);
  });

  it('passes edits that are not boxes through untouched', () => {
    const r = devSampleRecipe('s');
    const e = setField(findLayer(r, 's1', 's1-title')!, 'sizePx', 80, 'Title size 80');
    expect(touchesBox(e)).toBe(false);
    expect(toSizeOnly(r, e)).toBe(e);
  });
});
