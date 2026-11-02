/** Hybrid search: keyword ranks and vector ranks merged by reciprocal rank fusion. Pure. */
import { queryWords } from '../askAll';
import type { MemoryItem, VectorRow } from '../memory/types';
import { cosine } from './quantize';

export const RRF_K = 60;
/** Below this cosine a window is not a match (MiniLM puts unrelated text around 0 to 0.2). */
export const MIN_COSINE = 0.3;

/** Reciprocal rank fusion: each list adds 1 / (k + rank); best first, earlier lists win ties. */
export function fuse(lists: string[][], k: number = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  lists.forEach((list) => list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))));
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
}

/** A window without its text or vector; the text is fetched only for the hits shown. */
export type WindowRef = Pick<VectorRow, 'id' | 'meetingId' | 'atMs' | 'endMs'>;
export interface WindowHit { row: WindowRef; score: number }

/** Windows at or above `min` cosine to the query, best first. */
export function rankWindows<R extends WindowRef & Pick<VectorRow, 'v'>>(query: ArrayLike<number>, rows: R[], min: number = MIN_COSINE): { row: R; score: number }[] {
  return rows
    .map((row) => ({ row, score: cosine(query, row.v) }))
    .filter((h) => h.score >= min)
    .sort((a, b) => b.score - a.score);
}

/** Meeting ids in the order of their best window. */
export function meetingsByWindows(hits: WindowHit[]): string[] {
  return [...new Set(hits.map((h) => h.row.meetingId))];
}

const count = (hay: string, w: string): number => (hay.length ? hay.split(w).length - 1 : 0);

/** Keyword score of a memory item: its text counts double its quote. */
export function scoreItem(item: Pick<MemoryItem, 'text' | 'quote'>, query: string): number {
  const text = item.text.toLowerCase();
  const quote = item.quote.text.toLowerCase();
  return queryWords(query).reduce((s, w) => s + Math.min(count(text, w), 2) * 2 + Math.min(count(quote, w), 2), 0);
}

/** Items whose quote falls inside a matching window, in window order. */
export function itemsByWindows(items: MemoryItem[], hits: WindowHit[]): string[] {
  const byMeeting = new Map<string, MemoryItem[]>();
  for (const i of items) {
    const list = byMeeting.get(i.quote.meetingId);
    if (list) list.push(i);
    else byMeeting.set(i.quote.meetingId, [i]);
  }
  const ids = new Set<string>();
  for (const { row } of hits) {
    for (const i of byMeeting.get(row.meetingId) ?? []) if (i.quote.atMs >= row.atMs && i.quote.atMs <= row.endMs) ids.add(i.id);
  }
  return [...ids];
}

/** Items search can show: not dismissed and with a quote the checker found. */
export const searchable = (i: MemoryItem): boolean => i.status !== 'dismissed' && !i.leftOut;
