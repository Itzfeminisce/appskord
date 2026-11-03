/** board-damaged: a copy that keeps every card the validator can read, leaving the original untouched. */
import { validateBoard } from '@/lib/board/validate';
import type { Board, Card } from '@/lib/board/types';

const record = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** The readable cards of a damaged board in a new, valid board with id `newId`; undefined when no card can be read. */
export function repairBoard(raw: unknown, newId: string, now: number): Board | undefined {
  const source = record(raw);
  const name = text(source.name, '');
  const cards: Record<string, Card> = {};
  for (const [id, value] of Object.entries(record(source.cards))) {
    const card = record(value);
    if (card.id !== id) continue;
    const probe = { version: 1, id: 'probe', name: '', pinned: false, createdAt: 0, updatedAt: 0, cards: { [id]: value }, arrows: [], groups: [], sections: [{ id: 's', title: '', minutes: 0, cards: [id] }] };
    const checked = validateBoard(probe);
    if (checked.ok) cards[id] = checked.board.cards[id]!;
  }
  const ids = Object.keys(cards);
  if (ids.length === 0) return undefined;

  const placed = new Set<string>();
  const sections = list(source.sections).flatMap((s, i) => {
    const sec = record(s);
    const sectionCards = list(sec.cards).filter((c): c is string => typeof c === 'string' && cards[c] !== undefined && !placed.has(c));
    sectionCards.forEach((c) => placed.add(c));
    const minutes = typeof sec.minutes === 'number' && Number.isFinite(sec.minutes) ? sec.minutes : 0;
    return [{ id: typeof sec.id === 'string' && sec.id ? sec.id : `section-${i}`, title: text(sec.title, ''), minutes, cards: sectionCards }];
  });
  const unique = sections.filter((s, i) => sections.findIndex((o) => o.id === s.id) === i);
  if (unique.length === 0) unique.push({ id: 'section-0', title: '', minutes: 0, cards: [] });
  unique[unique.length - 1]!.cards.push(...ids.filter((id) => !placed.has(id) && !unique.some((s) => s.cards.includes(id))));

  const arrows = list(source.arrows).flatMap((a) => {
    const arrow = record(a);
    const ok = typeof arrow.id === 'string' && typeof arrow.from === 'string' && typeof arrow.to === 'string' && cards[arrow.from] && cards[arrow.to] && arrow.from !== arrow.to;
    return ok ? [{ id: arrow.id as string, from: arrow.from as string, to: arrow.to as string, ...(arrow.dashed === true ? { dashed: true } : {}) }] : [];
  });
  const groups = list(source.groups).flatMap((g) => {
    const group = record(g);
    const members = list(group.cards).filter((c): c is string => typeof c === 'string' && cards[c] !== undefined);
    return typeof group.id === 'string' && members.length > 0 ? [{ id: group.id, title: text(group.title, ''), cards: [...new Set(members)] }] : [];
  });

  const copy: Board = { version: 1, id: newId, name, pinned: false, createdAt: now, updatedAt: now, cards, arrows: dedupe(arrows), groups: dedupe(groups), sections: unique };
  const checked = validateBoard(copy);
  if (checked.ok) return checked.board;
  // Arrows or groups that still fail are dropped; the cards are what matters.
  const bare = validateBoard({ ...copy, arrows: [], groups: [] });
  return bare.ok ? bare.board : undefined;
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => !seen.has(i.id) && (seen.add(i.id), true));
}
