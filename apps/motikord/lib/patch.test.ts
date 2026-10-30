import { describe, expect, it } from 'vitest';
import { applyPatch, PatchError, parsePointer } from './patch';
import type { PatchOp } from './types';

const doc = () => ({ name: 'Clip', scenes: [{ id: 'a', layers: [1, 2, 3] }, { id: 'b', layers: [] as number[] }], 'x/y': { '~': 1 } });

function roundTrip(ops: PatchOp[]) {
  const before = doc();
  const frozen = structuredClone(before);
  const { doc: after, inverse } = applyPatch(before, ops);
  expect(before).toEqual(frozen); // input untouched
  expect(applyPatch(after, inverse).doc).toEqual(frozen);
  return after;
}

describe('applyPatch', () => {
  it('replaces and inverts', () => {
    expect(roundTrip([{ op: 'replace', path: '/name', value: 'New' }]).name).toBe('New');
  });

  it('adds to objects and lists, including "-" for the end', () => {
    const after = roundTrip([
      { op: 'add', path: '/prompt', value: 'hi' },
      { op: 'add', path: '/scenes/0/layers/1', value: 9 },
      { op: 'add', path: '/scenes/1/layers/-', value: 7 },
    ]);
    expect(after).toMatchObject({ prompt: 'hi', scenes: [{ layers: [1, 9, 2, 3] }, { layers: [7] }] });
  });

  it('add over an existing key inverts to the old value', () => {
    expect(roundTrip([{ op: 'add', path: '/name', value: 'Over' }]).name).toBe('Over');
  });

  it('removes and inverts', () => {
    const after = roundTrip([{ op: 'remove', path: '/scenes/0/layers/0' }, { op: 'remove', path: '/name' }]);
    expect(after).not.toHaveProperty('name');
    expect(after.scenes[0]!.layers).toEqual([2, 3]);
  });

  it('moves within a list and between branches, and inverts', () => {
    const after = roundTrip([
      { op: 'move', from: '/scenes/1', path: '/scenes/0' },
      { op: 'move', from: '/scenes/1/layers/2', path: '/scenes/0/layers/0' },
    ]);
    expect(after.scenes.map((s) => s.id)).toEqual(['b', 'a']);
    expect(after.scenes[0]!.layers).toEqual([3]);
    expect(after.scenes[1]!.layers).toEqual([1, 2]);
  });

  it('move over an existing key restores it on undo', () => {
    roundTrip([{ op: 'move', from: '/x~1y', path: '/name' }]);
  });

  it('decodes ~0 and ~1', () => {
    expect(parsePointer('/x~1y/~0')).toEqual(['x/y', '~']);
    expect(roundTrip([{ op: 'replace', path: '/x~1y/~0', value: 2 }])['x/y']['~']).toBe(2);
  });

  it('shares untouched branches', () => {
    const before = doc();
    const { doc: after } = applyPatch(before, [{ op: 'replace', path: '/scenes/0/id', value: 'z' }]);
    expect(after.scenes[1]).toBe(before.scenes[1]);
    expect(after.scenes[0]).not.toBe(before.scenes[0]);
  });

  it('does not keep a reference to the value it was given', () => {
    const value = { id: 'c', layers: [] };
    const { doc: after } = applyPatch(doc(), [{ op: 'add', path: '/scenes/-', value }]);
    value.id = 'changed';
    expect(after.scenes[2]!.id).toBe('c');
  });

  it('throws a plain-word PatchError for bad paths', () => {
    expect(() => applyPatch(doc(), [{ op: 'replace', path: '/nope', value: 1 }])).toThrow(PatchError);
    expect(() => applyPatch(doc(), [{ op: 'remove', path: '/scenes/5' }])).toThrow(/past the end/);
    expect(() => applyPatch(doc(), [{ op: 'add', path: 'name', value: 1 }])).toThrow(/must start with \//);
    expect(() => applyPatch(doc(), [{ op: 'move', from: '/scenes', path: '/scenes/0' }])).toThrow(/inside itself/);
  });
});

describe('patch guards', () => {
  it('rejects prototype paths', () => {
    expect(() => applyPatch({ a: {} }, [{ op: 'add', path: '/a/__proto__', value: { x: 1 } }])).toThrow(PatchError);
  });
  it('treats a move onto itself as a no-op', () => {
    const doc = { a: [1, 2] };
    expect(applyPatch(doc, [{ op: 'move', from: '/a/0', path: '/a/0' }]).doc).toEqual(doc);
  });
});
