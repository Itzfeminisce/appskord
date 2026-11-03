/** "Drag cards in or out": after a move, a card dropped clear of its group leaves it, and a loose card dropped inside a group joins it. */
import { addGroup, deleteGroup, groupRect } from '@/lib/board/ops';
import type { Board, Group, Rect } from '@/lib/board/types';

const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const holds = (r: Rect, p: { x: number; y: number }) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

const withCards = (board: Board, group: Group, cards: string[], now: number): Board => {
  const without = deleteGroup(board, group.id, now);
  return cards.length ? addGroup(without, { ...group, cards }, now) : without;
};

export function regroup(board: Board, moved: readonly string[], now: number): Board {
  const movedSet = new Set(moved);
  let next = board;
  for (const id of moved) {
    const card = next.cards[id];
    if (!card) continue;
    const group = next.groups.find((g) => g.cards.includes(id));
    if (group) {
      // A whole group moving together stays together.
      const others = group.cards.filter((c) => c !== id && !movedSet.has(c));
      if (others.length === 0) continue;
      const box = groupRect(next, { ...group, cards: others });
      if (box && !touches(card.rect, box)) next = withCards(next, group, group.cards.filter((c) => c !== id), now);
      continue;
    }
    const centre = { x: card.rect.x + card.rect.w / 2, y: card.rect.y + card.rect.h / 2 };
    const target = next.groups.find((g) => !g.cards.some((c) => movedSet.has(c)) && holds(groupRect(next, g) ?? { x: 0, y: 0, w: 0, h: 0 }, centre));
    if (target) next = withCards(next, target, [...target.cards, id], now);
  }
  return next;
}
