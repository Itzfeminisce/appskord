/** Ids across a round trip: an import gets "<nonce>~<origin id>"; an edit file carries origin ids, so cards match on the way back. */
import type { Board, Card, FileRef } from '../board/types';

const SEP = '~';

/** The id a board, card or file had on the board it was first made on. */
export const originId = (id: string): string => id.slice(id.lastIndexOf(SEP) + 1);

/** A new id for an imported copy of `id`; the whole id is kept, so two ids with one origin stay apart. */
export const importedId = (nonce: string, id: string): string => `${nonce}${SEP}${id}`;

/** Every board-level id (board, cards, sections, arrows, groups, files, Brief me card refs) passed through `map`. Inner ids stay. */
export function mapIds(board: Board, map: (id: string) => string): Board {
  const file = (f: FileRef): FileRef => ({ ...f, id: map(f.id) });
  const cards: Record<string, Card> = {};
  for (const card of Object.values(board.cards)) {
    let next = { ...card, id: map(card.id) } as Card;
    if (next.kind === 'image' || next.kind === 'file') next = { ...next, file: file(next.file) };
    if (next.kind === 'link' && next.preview) next = { ...next, preview: file(next.preview) };
    if (next.kind === 'diagram') {
      const d = next.diagram;
      next = { ...next, diagram: { ...d, nodes: d.nodes.map((n) => (n.card ? { ...n, card: map(n.card) } : n)) } };
    }
    cards[next.id] = next;
  }
  return {
    ...board,
    id: map(board.id),
    cards,
    sections: board.sections.map((s) => ({ ...s, id: map(s.id), cards: s.cards.map(map) })),
    arrows: board.arrows.map((a) => ({ ...a, id: map(a.id), from: map(a.from), to: map(a.to) })),
    groups: board.groups.map((g) => ({ ...g, id: map(g.id), cards: g.cards.map(map) })),
    ...(board.brief ? { brief: { ...board.brief, points: board.brief.points.map((p) => ({ ...p, cards: p.cards.map(map) })) } } : {}),
  };
}

/** Each board-level id -> its origin id. An id whose origin is taken on this board keeps its own id. */
export function originIds(board: Board): (id: string) => string {
  const all = [
    board.id,
    ...Object.keys(board.cards),
    ...board.sections.map((s) => s.id),
    ...board.arrows.map((a) => a.id),
    ...board.groups.map((g) => g.id),
    ...Object.values(board.cards).flatMap((c) =>
      c.kind === 'image' || c.kind === 'file' ? [c.file.id] : c.kind === 'link' && c.preview ? [c.preview.id] : [],
    ),
  ];
  const taken = new Set<string>();
  const map = new Map<string, string>();
  // Plain ids first, so a card made on this board keeps its id over an imported one.
  for (const id of [...new Set(all)].sort((a, b) => Number(a.includes(SEP)) - Number(b.includes(SEP)))) {
    const origin = originId(id);
    const next = taken.has(origin) ? id : origin;
    taken.add(next);
    map.set(id, next);
  }
  return (id) => map.get(id) ?? id;
}

/** The board with origin ids, as an edit file carries it. */
export const toOriginIds = (board: Board): Board => mapIds(board, originIds(board));
