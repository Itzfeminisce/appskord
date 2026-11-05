import { describe, expect, it } from 'vitest';
import { listOrder } from '@/lib/board/ops';
import { sampleBoard } from '@/lib/board/sample';
import { validateBoard } from '@/lib/board/validate';
import { agendaCount, deleteSectionKeepCards, nearestSlot, numberAfterDrop, ordinal, rowDetail, slotIndex, stepInList } from './logic';

const board = sampleBoard(0);
const ids = (b: typeof board) => b.sections.map((s) => `${s.id}:${s.cards.join(',')}`);

describe('deleteSectionKeepCards', () => {
  it('moves the cards to the start of the next section and deletes nothing from the board', () => {
    const next = deleteSectionKeepCards(board, 'context', 5);
    expect(ids(next)).toEqual(['the-flow:why-now,findings,flow,step-2', 'decisions:report,new-checkout,before-ship']);
    expect(Object.keys(next.cards)).toHaveLength(7);
    expect(next.cards).toBe(board.cards);
    expect(next.updatedAt).toBe(5);
    expect(validateBoard(next).ok).toBe(true);
  });

  it('moves the last section’s cards to the one before it', () => {
    const next = deleteSectionKeepCards(board, 'decisions', 5);
    expect(ids(next)).toEqual(['context:why-now,findings', 'the-flow:flow,step-2,report,new-checkout,before-ship']);
  });

  it('keeps the only section', () => {
    const one = { ...board, sections: [{ id: 'all', title: 'Agenda', minutes: 0, cards: listOrder(board) }] };
    expect(deleteSectionKeepCards(one, 'all', 5)).toBe(one);
  });
});

describe('stepInList', () => {
  it('moves one place, across section edges, and stops at the ends', () => {
    expect(listOrder(stepInList(board, 'why-now', 1, 1)).slice(0, 2)).toEqual(['findings', 'why-now']);
    expect(ids(stepInList(board, 'findings', 1, 1))[1]).toBe('the-flow:findings,flow,step-2');
    expect(ids(stepInList(board, 'flow', -1, 1))[0]).toBe('context:why-now,findings,flow');
    expect(stepInList(board, 'why-now', -1, 1)).toBe(board);
    expect(stepInList(board, 'before-ship', 1, 1)).toBe(board);
  });

  it('never moves a card on the canvas', () => {
    const next = stepInList(board, 'findings', 1, 1);
    expect(next.cards.findings!.rect).toEqual(board.cards.findings!.rect);
  });
});

describe('drag slots', () => {
  it('lands where the line shows', () => {
    const slots = [
      { section: 'context', slot: 0, y: 10 },
      { section: 'context', slot: 1, y: 70 },
      { section: 'context', slot: 2, y: 130 },
    ];
    expect(nearestSlot(slots, 64)).toBe(slots[1]);
    expect(slotIndex(board, 'why-now', slots[2]!)).toBe(1);
    expect(slotIndex(board, 'report', { section: 'context', slot: 1, y: 0 })).toBe(1);
    expect(numberAfterDrop(board, 'findings', { section: 'context', slot: 0, y: 0 })).toBe(1);
    expect(numberAfterDrop(board, 'before-ship', { section: 'context', slot: 1, y: 0 })).toBe(2);
  });

  it('says the place in words', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
});

describe('row words', () => {
  it('describes each kind', () => {
    expect(agendaCount(board)).toBe('7 cards in 3 sections');
    expect(rowDetail(board, board.cards.flow!)).toBe('Diagram · 6 boxes');
    expect(rowDetail(board, board.cards.report!)).toBe('File · 12 pages');
    expect(rowDetail(board, board.cards['before-ship']!)).toBe('Checklist · 1/3');
    expect(rowDetail(board, board.cards.findings!)).toBe('Link · baymard.com');
  });
});
