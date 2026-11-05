/** Three-way merge for boards written from two pages at once: what changed only outside is taken, local edits are kept. Pure. */
import type { History } from './history';
import type { Arrow, Board, Card, DiagramNode, Group, Section } from './types';

type Keyed = { id: string };

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** What another page changed in a list of keyed items between `base` and `theirs`. */
interface Diff<T extends Keyed> {
  base: Map<string, T>;
  theirs: T[];
  added: Set<string>;
  removed: Set<string>;
  changed: Map<string, T>;
}

function diff<T extends Keyed>(base: readonly T[], theirs: readonly T[]): Diff<T> {
  const before = new Map(base.map((i) => [i.id, i]));
  const after = new Map(theirs.map((i) => [i.id, i]));
  const changed = new Map<string, T>();
  for (const [id, item] of after) if (before.has(id) && !same(before.get(id), item)) changed.set(id, item);
  return {
    base: before,
    theirs: [...theirs],
    added: new Set([...after.keys()].filter((id) => !before.has(id))),
    removed: new Set([...before.keys()].filter((id) => !after.has(id))),
    changed,
  };
}

/** `mine` with outside additions (at their outside place), deletions, and changes to items `mine` left alone. */
function apply<T extends Keyed>(d: Diff<T>, mine: readonly T[]): T[] {
  const out = mine
    .filter((i) => !d.removed.has(i.id))
    .map((i) => (d.changed.has(i.id) && same(i, d.base.get(i.id)) ? d.changed.get(i.id)! : i));
  const have = new Set(out.map((i) => i.id));
  d.theirs.forEach((item, index) => {
    if (d.added.has(item.id) && !have.has(item.id)) out.splice(Math.min(index, out.length), 0, item);
  });
  return out;
}

const pick = <T>(base: T, theirs: T, mine: T): T => (same(mine, base) ? theirs : mine);

export interface OutsideChange {
  base: Board;
  theirs: Board;
  cards: Diff<Card>;
  sections: Diff<Section>;
  arrows: Diff<Arrow>;
  groups: Diff<Group>;
}

/** What changed between the board this page last stored and the one now stored. */
export function outsideChange(base: Board, theirs: Board): OutsideChange {
  return {
    base,
    theirs,
    cards: diff(Object.values(base.cards), Object.values(theirs.cards)),
    sections: diff(base.sections, theirs.sections),
    arrows: diff(base.arrows, theirs.arrows),
    groups: diff(base.groups, theirs.groups),
  };
}

/** `mine` rebased onto the outside change; the result always passes the validator's cross-checks. */
export function applyOutside(change: OutsideChange, mine: Board): Board {
  const { base, theirs } = change;
  const cards: Record<string, Card> = {};
  for (const card of apply(change.cards, Object.values(mine.cards))) cards[card.id] = card;
  const has = (id: string) => cards[id] !== undefined;

  // Each card in exactly one section: first place wins, then unplaced cards go where the outside page put them.
  const placed = new Set<string>();
  const sections = apply(change.sections, mine.sections).map((s) => {
    const kept = s.cards.filter((id) => has(id) && !placed.has(id));
    kept.forEach((id) => placed.add(id));
    return { ...s, cards: kept };
  });
  if (sections.length === 0) sections.push(...(theirs.sections.length ? theirs.sections : mine.sections).map((s) => ({ ...s, cards: [] as string[] })));
  for (const id of Object.keys(cards)) {
    if (placed.has(id)) continue;
    const from = theirs.sections.find((s) => s.cards.includes(id)) ?? mine.sections.find((s) => s.cards.includes(id));
    const into = sections.find((s) => s.id === from?.id) ?? sections[0]!;
    const index = from ? from.cards.indexOf(id) : into.cards.length;
    into.cards.splice(Math.min(index, into.cards.length), 0, id);
    placed.add(id);
  }

  const unlink = (n: DiagramNode): DiagramNode => {
    if (!n.card || has(n.card)) return n;
    const { card: _gone, ...rest } = n;
    return rest;
  };
  for (const [id, card] of Object.entries(cards)) {
    if (card.kind === 'diagram' && card.diagram.nodes.some((n) => n.card && !has(n.card))) cards[id] = { ...card, diagram: { ...card.diagram, nodes: card.diagram.nodes.map(unlink) } };
  }

  const arrows = apply(change.arrows, mine.arrows).filter((a) => has(a.from) && has(a.to) && a.from !== a.to);
  const groups = apply(change.groups, mine.groups)
    .map((g) => ({ ...g, cards: g.cards.filter(has) }))
    .filter((g) => g.cards.length > 0);

  const merged: Board = {
    ...mine,
    name: pick(base.name, theirs.name, mine.name),
    pinned: pick(base.pinned, theirs.pinned, mine.pinned),
    updatedAt: Math.max(mine.updatedAt, theirs.updatedAt),
    cards,
    sections,
    arrows,
    groups,
  };
  for (const key of ['brief', 'imported'] as const) {
    const value = pick(base[key], theirs[key], mine[key]);
    if (value === undefined) delete merged[key];
    else (merged as unknown as Record<string, unknown>)[key] = value;
  }
  return merged;
}

export const mergeBoards = (base: Board, theirs: Board, mine: Board): Board => applyOutside(outsideChange(base, theirs), mine);

/** Every undo step rebased onto the outside change, so undo never takes another page's capture back off. */
export function rebaseHistory(history: History, change: OutsideChange, present?: Board): History {
  const step = (b: Board) => applyOutside(change, b);
  return { past: history.past.map(step), present: present ?? step(history.present), future: history.future.map(step) };
}
