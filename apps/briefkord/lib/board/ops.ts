/**
 * Pure board changes. Each returns a new board (the same board when nothing changes) and keeps every card in exactly one
 * section. Ids and times come from the caller, so the changes stay testable.
 */
import type { Arrow, Board, Card, CardColour, DiagramNode, Group, Rect, Section } from './types';

/** A fresh id for a card, section, arrow, group or file. */
export const newId = (): string => crypto.randomUUID();

/** Smallest canvas size of a card, in canvas units. */
export const MIN_CARD = { w: 120, h: 60 };

const touch = (board: Board, now: number, patch: Partial<Board>): Board => ({ ...board, ...patch, updatedAt: now });

const editCards = (board: Board, ids: readonly string[], now: number, edit: (card: Card) => Card): Board => {
  const cards = { ...board.cards };
  let changed = false;
  for (const id of ids) {
    const card = cards[id];
    if (!card) continue;
    const next = edit(card);
    if (next === card) continue;
    cards[id] = { ...next, id: card.id, kind: card.kind, updatedAt: now } as Card;
    changed = true;
  }
  return changed ? touch(board, now, { cards }) : board;
};

/** The highest z on the board, or 0 when it has no cards. */
export const topZ = (board: Board): number => Object.values(board.cards).reduce((z, c) => Math.max(z, c.z), 0);

/** Adds a card on top, at `index` (default the end) of a section (default the last). */
export function addCard(board: Board, card: Card, now: number, at: { sectionId?: string; index?: number } = {}): Board {
  if (board.cards[card.id]) return board;
  const target = at.sectionId ?? board.sections[board.sections.length - 1]?.id;
  if (!board.sections.some((s) => s.id === target)) return board;
  const sections = board.sections.map((s) => (s.id === target ? { ...s, cards: insert(s.cards, card.id, at.index) } : s));
  const placed = { ...card, z: topZ(board) + 1, createdAt: card.createdAt || now, updatedAt: now } as Card;
  return touch(board, now, { cards: { ...board.cards, [card.id]: placed }, sections });
}

/** Changes a card's own fields; its id and kind stay. */
export function updateCard(board: Board, id: string, now: number, edit: (card: Card) => Card): Board {
  return editCards(board, [id], now, edit);
}

export function moveCards(board: Board, ids: readonly string[], dx: number, dy: number, now: number): Board {
  if (dx === 0 && dy === 0) return board;
  return editCards(board, ids, now, (c) => ({ ...c, rect: { ...c.rect, x: c.rect.x + dx, y: c.rect.y + dy } }));
}

export function resizeCard(board: Board, id: string, rect: Rect, now: number): Board {
  const next = { ...rect, w: Math.max(MIN_CARD.w, rect.w), h: Math.max(MIN_CARD.h, rect.h) };
  return editCards(board, [id], now, (c) => (sameRect(c.rect, next) ? c : { ...c, rect: next }));
}

export function recolourCards(board: Board, ids: readonly string[], colour: CardColour, now: number): Board {
  return editCards(board, ids, now, (c) => (c.colour === colour ? c : { ...c, colour }));
}

/** Puts the cards above every other card, keeping their order among themselves. */
export function bringToFront(board: Board, ids: readonly string[], now: number): Board {
  let z = topZ(board);
  const order = ids.filter((id) => board.cards[id]).sort((a, b) => board.cards[a]!.z - board.cards[b]!.z);
  return editCards(board, order, now, (c) => ({ ...c, z: ++z }));
}

/** Removes cards and everything that names them: arrows, group places, list places and diagram links. */
export function deleteCards(board: Board, ids: readonly string[], now: number): Board {
  const gone = new Set(ids.filter((id) => board.cards[id]));
  if (gone.size === 0) return board;
  const unlink = (n: DiagramNode): DiagramNode => {
    if (!n.card || !gone.has(n.card)) return n;
    const { card: _gone, ...rest } = n;
    return rest;
  };
  const cards: Record<string, Card> = {};
  for (const [id, card] of Object.entries(board.cards)) {
    if (gone.has(id)) continue;
    cards[id] = card.kind === 'diagram' && card.diagram.nodes.some((n) => n !== unlink(n))
      ? { ...card, updatedAt: now, diagram: { ...card.diagram, nodes: card.diagram.nodes.map(unlink) } }
      : card;
  }
  return touch(board, now, {
    cards,
    arrows: board.arrows.filter((a) => !gone.has(a.from) && !gone.has(a.to)),
    groups: board.groups.map((g) => ({ ...g, cards: g.cards.filter((c) => !gone.has(c)) })).filter((g) => g.cards.length > 0),
    sections: board.sections.map((s) => ({ ...s, cards: s.cards.filter((c) => !gone.has(c)) })),
  });
}

/** Adds an arrow between two different cards; a second arrow between the same pair is refused. */
export function addArrow(board: Board, arrow: Arrow, now: number): Board {
  const { from, to } = arrow;
  if (from === to || !board.cards[from] || !board.cards[to]) return board;
  if (board.arrows.some((a) => a.id === arrow.id || (a.from === from && a.to === to))) return board;
  return touch(board, now, { arrows: [...board.arrows, arrow] });
}

export function setArrowDashed(board: Board, id: string, dashed: boolean, now: number): Board {
  const arrow = board.arrows.find((a) => a.id === id);
  if (!arrow || Boolean(arrow.dashed) === dashed) return board;
  return touch(board, now, { arrows: board.arrows.map((a) => (a.id === id ? { ...a, dashed } : a)) });
}

export function deleteArrow(board: Board, id: string, now: number): Board {
  if (!board.arrows.some((a) => a.id === id)) return board;
  return touch(board, now, { arrows: board.arrows.filter((a) => a.id !== id) });
}

/** Groups existing cards; a card leaves any group it was in, and a group left empty goes. */
export function addGroup(board: Board, group: Group, now: number): Board {
  const cards = [...new Set(group.cards.filter((id) => board.cards[id]))];
  if (cards.length === 0 || board.groups.some((g) => g.id === group.id)) return board;
  const taken = new Set(cards);
  const others = board.groups.map((g) => ({ ...g, cards: g.cards.filter((c) => !taken.has(c)) })).filter((g) => g.cards.length > 0);
  return touch(board, now, { groups: [...others, { ...group, cards }] });
}

export function renameGroup(board: Board, id: string, title: string, now: number): Board {
  const group = board.groups.find((g) => g.id === id);
  if (!group || group.title === title) return board;
  return touch(board, now, { groups: board.groups.map((g) => (g.id === id ? { ...g, title } : g)) });
}

/** Ungroups; the cards stay. */
export function deleteGroup(board: Board, id: string, now: number): Board {
  if (!board.groups.some((g) => g.id === id)) return board;
  return touch(board, now, { groups: board.groups.filter((g) => g.id !== id) });
}

/** The box around a group's cards, `pad` units out; undefined when the group has no cards on the board. */
export function groupRect(board: Board, group: Group, pad = 18): Rect | undefined {
  const rects = group.cards.map((id) => board.cards[id]?.rect).filter((r): r is Rect => r !== undefined);
  if (rects.length === 0) return undefined;
  const x = Math.min(...rects.map((r) => r.x)) - pad;
  const y = Math.min(...rects.map((r) => r.y)) - pad;
  const right = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const bottom = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x, y, w: right - x, h: bottom - y };
}

/** Adds an empty section at `index` (default the end). */
export function addSection(board: Board, section: Omit<Section, 'cards'>, now: number, index?: number): Board {
  if (board.sections.some((s) => s.id === section.id)) return board;
  return touch(board, now, { sections: insert(board.sections, { ...section, cards: [] }, index) });
}

export function renameSection(board: Board, id: string, title: string, now: number): Board {
  return editSection(board, id, now, (s) => (s.title === title ? s : { ...s, title }));
}

export function setSectionMinutes(board: Board, id: string, minutes: number, now: number): Board {
  const m = Math.max(0, Math.round(minutes));
  return editSection(board, id, now, (s) => (s.minutes === m ? s : { ...s, minutes: m }));
}

/** Moves a section to `index` in the list. */
export function moveSection(board: Board, id: string, index: number, now: number): Board {
  const from = board.sections.findIndex((s) => s.id === id);
  const to = clamp(index, 0, board.sections.length - 1);
  if (from < 0 || from === to) return board;
  const sections = [...board.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(to, 0, moved!);
  return touch(board, now, { sections });
}

/** Deletes a section and moves its cards to the end of the one before it (or the start of the next). The last section stays. */
export function deleteSection(board: Board, id: string, now: number): Board {
  const at = board.sections.findIndex((s) => s.id === id);
  if (at < 0 || board.sections.length < 2) return board;
  const moving = board.sections[at]!.cards;
  const into = at > 0 ? at - 1 : at + 1;
  const sections = board.sections
    .map((s, i) => (i !== into ? s : { ...s, cards: at > 0 ? [...s.cards, ...moving] : [...moving, ...s.cards] }))
    .filter((s) => s.id !== id);
  return touch(board, now, { sections });
}

/** Moves a card to `index` in a section, the list's drag and drop. */
export function moveCardInList(board: Board, cardId: string, sectionId: string, index: number, now: number): Board {
  if (!board.cards[cardId] || !board.sections.some((s) => s.id === sectionId)) return board;
  const from = board.sections.find((s) => s.cards.includes(cardId));
  if (from?.id === sectionId && from.cards.indexOf(cardId) === clamp(index, 0, from.cards.length - 1)) return board;
  const without = board.sections.map((s) => (s.cards.includes(cardId) ? { ...s, cards: s.cards.filter((c) => c !== cardId) } : s));
  const sections = without.map((s) => (s.id === sectionId ? { ...s, cards: insert(s.cards, cardId, index) } : s));
  return touch(board, now, { sections });
}

/** Puts the cards in this order, keeping each section's size: the result of "Suggest an order". */
export function reorderList(board: Board, order: readonly string[], now: number): Board {
  const current = listOrder(board);
  const wanted = [...new Set(order.filter((id) => board.cards[id]))];
  const rest = current.filter((id) => !wanted.includes(id));
  const next = [...wanted, ...rest];
  if (next.every((id, i) => id === current[i])) return board;
  let at = 0;
  const sections = board.sections.map((s) => ({ ...s, cards: next.slice(at, (at += s.cards.length)) }));
  return touch(board, now, { sections });
}

/** Card ids in list order. */
export const listOrder = (board: Board): string[] => board.sections.flatMap((s) => s.cards);

/** Each card's number: its 1-based place in the list. */
export function cardNumbers(board: Board): Record<string, number> {
  return Object.fromEntries(listOrder(board).map((id, i) => [id, i + 1]));
}

/** The section a card sits in. */
export const sectionOf = (board: Board, cardId: string): Section | undefined => board.sections.find((s) => s.cards.includes(cardId));

export function renameBoard(board: Board, name: string, now: number): Board {
  return board.name === name ? board : touch(board, now, { name });
}

export function setPinned(board: Board, pinned: boolean, now: number): Board {
  return board.pinned === pinned ? board : touch(board, now, { pinned });
}

/** A new empty board with one section. */
export function emptyBoard(ids: { board: string; section: string }, name: string, sectionTitle: string, now: number): Board {
  return {
    version: 1,
    id: ids.board,
    name,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    cards: {},
    arrows: [],
    groups: [],
    sections: [{ id: ids.section, title: sectionTitle, minutes: 0, cards: [] }],
  };
}

function editSection(board: Board, id: string, now: number, edit: (s: Section) => Section): Board {
  const at = board.sections.findIndex((s) => s.id === id);
  if (at < 0) return board;
  const next = edit(board.sections[at]!);
  if (next === board.sections[at]) return board;
  return touch(board, now, { sections: board.sections.map((s, i) => (i === at ? next : s)) });
}

function insert<T>(items: readonly T[], item: T, index = items.length): T[] {
  const out = [...items];
  out.splice(clamp(index, 0, items.length), 0, item);
  return out;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), Math.max(lo, hi));
const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
