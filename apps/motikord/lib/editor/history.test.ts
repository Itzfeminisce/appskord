import { describe, expect, it } from 'vitest';
import type { PatchOp } from '../types';
import { canRedo, canUndo, MERGE_MS, record, redo, undo, type History } from './history';

const doc = { name: 'Clip', scenes: [{ id: 'a', layers: [{ id: 'l1', text: 'Hi', sizePx: 80 }] }] };
type Doc = typeof doc;
const empty: History = { past: [], future: [] };
const meta = (at: number, mergeKey?: string) => ({ by: 'hand' as const, summary: 's', at, id: `c${at}`, mergeKey });
const size = (v: number): PatchOp[] => [{ op: 'replace', path: '/scenes/0/layers/0/sizePx', value: v }];

describe('history', () => {
  it('undoes twice and redoes once, ending where it should', () => {
    let d: Doc = doc;
    let h = empty;
    ({ doc: d, history: h } = record(d, h, size(90), meta(1)));
    ({ doc: d, history: h } = record(d, h, [{ op: 'add', path: '/scenes/0/layers/-', value: { id: 'l2', text: 'New', sizePx: 40 } }], meta(5000)));
    expect(h.past).toHaveLength(2);
    expect(h.past[1]!.by).toBe('hand');
    ({ doc: d, history: h } = undo(d, h));
    ({ doc: d, history: h } = undo(d, h));
    expect(d).toEqual(doc);
    expect(canUndo(h)).toBe(false);
    ({ doc: d, history: h } = redo(d, h));
    expect(d.scenes[0]!.layers[0]!.sizePx).toBe(90);
    expect(d.scenes[0]!.layers).toHaveLength(1);
    expect(canRedo(h)).toBe(true);
    ({ doc: d, history: h } = redo(d, h));
    expect(d.scenes[0]!.layers).toHaveLength(2);
    expect(canRedo(h)).toBe(false);
  });

  it('a new change clears redo', () => {
    let { doc: d, history: h } = record(doc, empty, size(90), meta(1));
    ({ doc: d, history: h } = undo(d, h));
    ({ doc: d, history: h } = record(d, h, size(70), meta(2)));
    expect(h.future).toHaveLength(0);
    expect(d.scenes[0]!.layers[0]!.sizePx).toBe(70);
  });

  it('merges quick edits of the same thing into one change that undoes in one step', () => {
    let d: Doc = doc;
    let h = empty;
    for (const [i, text] of ['Hi!', 'Hi!!', 'Hi!!!'].entries()) {
      ({ doc: d, history: h } = record(d, h, [{ op: 'replace', path: '/scenes/0/layers/0/text', value: text }], meta(100 + i * 200, 'l1/text')));
    }
    expect(h.past).toHaveLength(1);
    expect(h.past[0]!.patch).toHaveLength(1);
    ({ doc: d, history: h } = undo(d, h));
    expect(d.scenes[0]!.layers[0]!.text).toBe('Hi');
  });

  it('does not merge after the window or across keys', () => {
    let { doc: d, history: h } = record(doc, empty, size(81), meta(0, 'size'));
    ({ doc: d, history: h } = record(d, h, size(82), meta(MERGE_MS + 1, 'size')));
    ({ doc: d, history: h } = record(d, h, [{ op: 'replace', path: '/name', value: 'X' }], meta(MERGE_MS + 2, 'name')));
    expect(h.past).toHaveLength(3);
  });

  it('leaves the doc and history alone when a patch cannot apply', () => {
    expect(() => record(doc, empty, [{ op: 'replace', path: '/nope', value: 1 }], meta(1))).toThrow();
    expect(undo(doc, empty).doc).toBe(doc);
    expect(redo(doc, empty).change).toBeUndefined();
  });
});
