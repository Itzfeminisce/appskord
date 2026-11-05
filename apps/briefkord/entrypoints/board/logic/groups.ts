/** "Drag cards in or out": after a move, a card whose centre lands outside its group's box (as it was before the move) leaves it, and a loose card dropped inside a group joins it. */
import { addGroup, deleteGroup, groupRect } from '@/lib/board/ops';
import type { Board, Group, Rect } from '@/lib/board/types';

const holds = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

const withCards = (board: Board, group: Group, cards: string[], now: number): Board => {
  const without = deleteGroup(board, group.id, now);
  return cards.length ? addGroup(without, { ...group, cards }, now) : without;
};

export function regroup(before: Board, board: Board, moved: readonly string[], now: number): Board {
  const movedSet = new Set(moved);
  let next = board;
  for (const id of moved) {
    const card = next.cards[id];
    if (!card) continue;
    const group = next.groups.find((g) => g.cards.includes(id));
    const centre = { x: card.rect.x + card.rect.w / 2, y: card.rect.y + card.rect.h / 2 };
    if (group) {
      // A whole group moving together stays together.
      if (group.cards.every((c) => c === id || movedSet.has(c))) continue;
      // The box before the move, so nudging a card inside its group never drops it out.
      const box = groupRect(before, group);
      if (box && !holds(box, centre)) next = withCards(next, group, group.cards.filter((c) => c !== id), now);
      continue;
    }
    const target = next.groups.find((g) => !g.cards.some((c) => movedSet.has(c)) && holds(groupRect(next, g) ?? { x: 0, y: 0, w: 0, h: 0 }, centre));
    if (target) next = withCards(next, target, [...target.cards, id], now);
  }
  return next;
}
