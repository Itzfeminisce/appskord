/** The List's pure helpers: moving rows, deleting a section, and the words a row shows. */
import { cardNumbers, deleteSection, moveCardInList } from '@/lib/board/ops';
import type { Board, Card } from '@/lib/board/types';
import { formatBytes } from '../logic/drop';
import { KIND_LABEL, siteOf } from '../logic/cards';

/** Alt ↑ / Alt ↓: one place up or down the list, across section edges. */
export function stepInList(board: Board, id: string, by: -1 | 1, now: number): Board {
  const at = board.sections.findIndex((s) => s.cards.includes(id));
  const section = board.sections[at];
  if (!section) return board;
  const i = section.cards.indexOf(id);
  if (by < 0) {
    if (i > 0) return moveCardInList(board, id, section.id, i - 1, now);
    const prev = board.sections[at - 1];
    return prev ? moveCardInList(board, id, prev.id, prev.cards.length, now) : board;
  }
  if (i < section.cards.length - 1) return moveCardInList(board, id, section.id, i + 1, now);
  const next = board.sections[at + 1];
  return next ? moveCardInList(board, id, next.id, 0, now) : board;
}

/** "Delete section": its cards go to the start of the next section (the one before, for the last), in order. */
export function deleteSectionKeepCards(board: Board, id: string, now: number): Board {
  const at = board.sections.findIndex((s) => s.id === id);
  const next = board.sections[at + 1];
  if (at < 0 || board.sections.length < 2 || !next) return deleteSection(board, id, now);
  const moving = board.sections[at]!.cards;
  const sections = board.sections
    .map((s) => (s.id === next.id ? { ...s, cards: [...moving, ...s.cards] } : s))
    .filter((s) => s.id !== id);
  return { ...board, sections, updatedAt: now };
}

/** A place a dragged row can land: before row `slot` of a section (`slot` = its row count for the end), at `y`. */
export interface Slot { section: string; slot: number; y: number }

export function nearestSlot(slots: readonly Slot[], y: number): Slot | undefined {
  let best: Slot | undefined;
  for (const s of slots) if (!best || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
  return best;
}

/** The section index `moveCardInList` wants for a slot counted with the dragged row still in place. */
export function slotIndex(board: Board, cardId: string, slot: Slot): number {
  const section = board.sections.find((s) => s.id === slot.section);
  const from = section?.cards.indexOf(cardId) ?? -1;
  return from >= 0 && slot.slot > from ? slot.slot - 1 : slot.slot;
}

/** The card's number once dropped there. */
export function numberAfterDrop(board: Board, cardId: string, slot: Slot): number {
  const moved = moveCardInList(board, cardId, slot.section, slotIndex(board, cardId, slot), 0);
  return cardNumbers(moved)[cardId] ?? 0;
}

/** "2nd", "11th", "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "7 cards in 3 sections". */
export function agendaCount(board: Board): string {
  const cards = board.sections.reduce((n, s) => n + s.cards.length, 0);
  const sections = board.sections.length;
  return `${cards} ${cards === 1 ? 'card' : 'cards'} in ${sections} ${sections === 1 ? 'section' : 'sections'}`;
}

/** The summary note made from a link card, if any. */
export const summaryOf = (board: Board, cardId: string) =>
  Object.values(board.cards).find((c) => c.kind === 'note' && c.summary?.of === cardId) as Extract<Card, { kind: 'note' }> | undefined;

/** A row's second line: "Link · baymard.com · has a summary", "Diagram · 6 boxes"… */
export function rowDetail(board: Board, card: Card): string {
  const parts: string[] = [KIND_LABEL[card.kind]];
  switch (card.kind) {
    case 'note': {
      const line = card.text.split('\n').find((l) => l.trim());
      if (line) parts.push(line.trim());
      break;
    }
    case 'link':
      if (card.site) parts.push(card.site);
      if (summaryOf(board, card.id)) parts.push('has a summary');
      break;
    case 'diagram': {
      const n = card.diagram.nodes.length;
      parts.push(`${n} ${n === 1 ? 'box' : 'boxes'}`);
      break;
    }
    case 'image':
      if (card.pageUrl && siteOf(card.pageUrl)) parts.push(`from ${siteOf(card.pageUrl)}`);
      break;
    case 'file':
      parts.push(card.pages ? `${card.pages} pages` : formatBytes(card.file.size));
      break;
    case 'checklist':
      parts.push(`${card.items.filter((i) => i.done).length}/${card.items.length}`);
      break;
  }
  return parts.join(' · ');
}
