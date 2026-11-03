/** Search across boards: card titles, notes, "What to say" and saved page text. Case-insensitive; every word must match. */
import { cardNumbers } from './board/ops';
import type { Board, Card } from './board/types';

export type SearchField = 'title' | 'note' | 'say' | 'page';

/** `start` inclusive, `end` exclusive, in UTF-16 units of `text`. */
export interface Range { start: number; end: number }

export interface FieldMatch { field: SearchField; text: string; ranges: Range[] }

export interface SearchMatch {
  boardId: string;
  boardName: string;
  cardId: string;
  /** The card's number in its board's list. */
  number: number;
  fields: FieldMatch[];
}

export function searchBoards(boards: readonly Board[], query: string): SearchMatch[] {
  const words = [...new Set(query.trim().split(/\s+/).filter(Boolean))];
  if (words.length === 0) return [];
  const patterns = words.map((w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu'));
  const out: SearchMatch[] = [];
  for (const board of boards) {
    const numbers = cardNumbers(board);
    const ordered = Object.values(board.cards).sort((a, b) => (numbers[a.id] ?? Infinity) - (numbers[b.id] ?? Infinity));
    for (const card of ordered) {
      const fields = fieldsOf(card)
        .map(({ field, text }) => ({ field, text, ranges: rangesIn(text, patterns) }))
        .filter((f) => f.ranges.length > 0);
      if (!patterns.every((p) => fields.some((f) => p.test(f.text)))) continue;
      out.push({ boardId: board.id, boardName: board.name, cardId: card.id, number: numbers[card.id] ?? 0, fields });
    }
  }
  return out;
}

/** A window of `radius` characters either side of the first range, with the ranges moved to match. */
export function snippet(field: FieldMatch, radius = 60): { text: string; ranges: Range[]; cutStart: boolean; cutEnd: boolean } {
  const first = field.ranges[0];
  if (!first) return { text: field.text.slice(0, radius * 2), ranges: [], cutStart: false, cutEnd: field.text.length > radius * 2 };
  const from = Math.max(0, first.start - radius);
  const to = Math.min(field.text.length, first.end + radius);
  const ranges = field.ranges
    .filter((r) => r.start >= from && r.end <= to)
    .map((r) => ({ start: r.start - from, end: r.end - from }));
  return { text: field.text.slice(from, to), ranges, cutStart: from > 0, cutEnd: to < field.text.length };
}

function fieldsOf(card: Card): { field: SearchField; text: string }[] {
  const fields: { field: SearchField; text: string }[] = [{ field: 'title', text: card.title }];
  if (card.kind === 'note') fields.push({ field: 'note', text: card.text });
  fields.push({ field: 'say', text: card.say });
  if (card.kind === 'link') fields.push({ field: 'page', text: card.text });
  return fields.filter((f) => f.text !== '');
}

/** Every match of every pattern, sorted, with overlapping or touching ranges merged. */
function rangesIn(text: string, patterns: readonly RegExp[]): Range[] {
  const found: Range[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(new RegExp(p.source, 'giu'))) found.push({ start: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const r of found) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}
