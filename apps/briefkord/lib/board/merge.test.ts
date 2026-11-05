import { describe, expect, it } from 'vitest';
import { commit, createHistory, undo } from './history';
import { mergeBoards, outsideChange, rebaseHistory } from './merge';
import { addArrow, addCard, deleteCards, renameBoard, updateCard } from './ops';
import { sampleBoard } from './sample';
import type { Board, NoteCard } from './types';
import { validateBoard } from './validate';

const T = 1_762_187_000_000;
const note = (id: string, text: string): NoteCard => ({
  id, kind: 'note', title: '', colour: 'yellow', rect: { x: 0, y: 0, w: 220, h: 150 }, z: 9, say: '', createdAt: T, updatedAt: T, text,
});
const retitle = (b: Board, id: string, title: string, now = T + 5) => updateCard(b, id, now, (c) => ({ ...c, title }));
const valid = (b: Board) => expect(validateBoard(b)).toEqual({ ok: true, board: b });

describe('mergeBoards', () => {
  const base = sampleBoard(T, 'b');

  it('keeps a card captured outside next to an edit made here', () => {
    const theirs = addCard(base, note('captured', 'From the panel'), T + 1, { sectionId: 'decisions' });
    const mine = retitle(base, 'why-now', 'Why now, really');
    const merged = mergeBoards(base, theirs, mine);
    expect(merged.cards.captured).toBeDefined();
    expect(merged.cards['why-now']!.title).toBe('Why now, really');
    expect(merged.sections.find((s) => s.id === 'decisions')!.cards).toContain('captured');
    valid(merged);
  });

  it('adds the outside card even when this page reordered its section', () => {
    const theirs = addCard(base, note('captured', 'x'), T + 1, { sectionId: 'context', index: 0 });
    const mine = { ...base, sections: base.sections.map((s) => (s.id === 'context' ? { ...s, cards: [...s.cards].reverse() } : s)) };
    const merged = mergeBoards(base, theirs, mine);
    expect(merged.sections[0]!.cards).toEqual(['captured', 'findings', 'why-now']);
    valid(merged);
  });

  it('removes a card deleted outside with everything that names it, keeping local additions', () => {
    const theirs = deleteCards(base, ['flow'], T + 1);
    const mine = addArrow(addCard(base, note('mine', 'local'), T + 2), { id: 'a1', from: 'mine', to: 'flow' }, T + 2);
    const merged = mergeBoards(base, theirs, mine);
    expect(merged.cards.flow).toBeUndefined();
    expect(merged.cards.mine).toBeDefined();
    expect(merged.arrows.some((a) => a.from === 'flow' || a.to === 'flow')).toBe(false);
    expect(merged.groups.some((g) => g.cards.includes('flow'))).toBe(false);
    valid(merged);
  });

  it('takes outside changes to what this page left alone; on the same card this page wins', () => {
    const theirs = renameBoard(retitle(retitle(base, 'report', 'Theirs'), 'why-now', 'Theirs too'), 'Renamed outside', T + 3);
    const mine = retitle(base, 'why-now', 'Mine');
    const merged = mergeBoards(base, theirs, mine);
    expect(merged.cards.report!.title).toBe('Theirs');
    expect(merged.cards['why-now']!.title).toBe('Mine');
    expect(merged.name).toBe('Renamed outside');
    expect(merged.updatedAt).toBe(T + 5);
  });
});

describe('rebaseHistory', () => {
  it('keeps undo steps and never undoes the outside card', () => {
    const base = sampleBoard(T, 'b');
    const edited = retitle(base, 'why-now', 'Step one');
    const history = commit(createHistory(base), edited);
    const theirs = addCard(base, note('captured', 'x'), T + 1);
    const rebased = rebaseHistory(history, outsideChange(base, theirs));
    expect(rebased.past).toHaveLength(1);
    expect(rebased.present.cards['why-now']!.title).toBe('Step one');
    const back = undo(rebased);
    expect(back.present.cards['why-now']!.title).toBe(base.cards['why-now']!.title);
    expect(back.present.cards.captured).toBeDefined();
    valid(back.present);
  });
});
