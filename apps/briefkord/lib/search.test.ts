import { describe, expect, it } from 'vitest';
import { renameBoard, updateCard } from './board/ops';
import { sampleBoard } from './board/sample';
import type { LinkCard } from './board/types';
import { searchBoards, snippet } from './search';

const boards = () => {
  const a = sampleBoard(0, 'a');
  const b = updateCard(renameBoard(sampleBoard(0, 'b'), 'Pricing sync', 1), 'findings', 1, (c) => ({
    ...(c as LinkCard),
    text: 'Coupon fields pull users away. The coupon field should hide behind a link.',
  }));
  return [a, b];
};

describe('searchBoards', () => {
  it('finds a word in titles across boards, ignoring case, with its range', () => {
    const hits = searchBoards(boards(), 'CHECKOUT');
    expect(hits.map((h) => `${h.boardId}:${h.number}`)).toEqual(['a:2', 'a:3', 'a:4', 'a:6', 'b:2', 'b:3', 'b:4', 'b:6']);
    expect(hits[1]!.fields).toEqual([{ field: 'title', text: 'Checkout flow today', ranges: [{ start: 0, end: 8 }] }]);
  });

  it('searches notes, what to say and page text', () => {
    expect(searchBoards(boards(), 'declined')[0]!.fields[0]).toMatchObject({ field: 'note', ranges: [{ start: 71, end: 79 }] });
    expect(searchBoards(boards(), 'support hears')[0]!.fields[0]).toMatchObject({ field: 'say', ranges: [{ start: 29, end: 36 }, { start: 37, end: 42 }] });
    const page = searchBoards(boards(), 'coupon');
    expect(page).toHaveLength(1);
    expect(page[0]).toMatchObject({ boardName: 'Pricing sync', fields: [{ field: 'page', ranges: [{ start: 0, end: 6 }, { start: 35, end: 41 }] }] });
  });

  it('needs every word somewhere on the card, and merges overlapping ranges', () => {
    expect(searchBoards(boards(), 'coupon pricing')).toEqual([]);
    const hits = searchBoards(boards(), 'pay payment');
    expect(hits[0]!.fields[0]!.ranges).toEqual([{ start: 12, end: 19 }]);
  });

  it('returns nothing for an empty query and treats symbols as text', () => {
    expect(searchBoards(boards(), '   ')).toEqual([]);
    expect(searchBoards(boards(), '38%').map((h) => h.cardId)).toEqual(['why-now', 'flow', 'why-now', 'flow']);
    expect(searchBoards(boards(), '(.*)')).toEqual([]);
  });

  it('cuts a snippet around the first match and moves its ranges', () => {
    const field = { field: 'page' as const, text: 'aaaa bbbb coupon cccc coupon', ranges: [{ start: 10, end: 16 }, { start: 22, end: 28 }] };
    expect(snippet(field, 5)).toEqual({ text: 'bbbb coupon cccc', ranges: [{ start: 5, end: 11 }], cutStart: true, cutEnd: true });
  });
});
