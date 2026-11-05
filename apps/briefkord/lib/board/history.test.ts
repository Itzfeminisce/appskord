import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, createHistory, HISTORY_LIMIT, redo, undo } from './history';
import { renameBoard } from './ops';
import { sampleBoard } from './sample';

const start = sampleBoard(0);
const named = (n: number) => renameBoard(start, `Board ${n}`, n);

describe('history', () => {
  it('undoes and redoes one change at a time', () => {
    let h = commit(commit(createHistory(start), named(1)), named(2));
    h = undo(h);
    expect(h.present.name).toBe('Board 1');
    h = undo(h);
    expect(h.present).toBe(start);
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present.name).toBe('Board 1');
    expect(canRedo(h)).toBe(true);
  });

  it('clears redo on a new change and ignores a change that changed nothing', () => {
    let h = undo(commit(createHistory(start), named(1)));
    h = commit(h, named(5));
    expect(canRedo(h)).toBe(false);
    expect(commit(h, h.present)).toBe(h);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps to undo`, () => {
    let h = createHistory(start);
    for (let n = 1; n <= HISTORY_LIMIT + 20; n++) h = commit(h, named(n));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    while (canUndo(h)) h = undo(h);
    expect(h.present.name).toBe('Board 20');
    expect(h.future).toHaveLength(HISTORY_LIMIT);
    for (let n = 0; n < 5; n++) h = redo(h);
    expect(h.present.name).toBe('Board 25');
  });
});
