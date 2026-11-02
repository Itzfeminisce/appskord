// Agenda tracking during a meeting: which items the transcript covered, the current one and its time left. Pure.
import type { Agenda, AgendaItem } from '../memory/types';
import type { Segment } from '../types';

const STOP = new Set('the and for with from about our your this that are was were will can into over then them they its'.split(' '));

/** Words that name an item: three letters or more, or a short code with a digit ("q3"). */
export function itemWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || STOP.has(raw) || (raw.length < 3 && !/\d/.test(raw))) continue;
    const w = raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** A line mentions an item when it holds two of its words (one, for a one-word item). */
export function mentions(item: Pick<AgendaItem, 'text'>, line: string): boolean {
  const words = itemWords(item.text);
  if (!words.length) return false;
  const said = new Set(itemWords(line));
  const hits = words.filter((w) => said.has(w) || [...said].some((s) => s.length > 4 && w.length > 4 && (s.startsWith(w) || w.startsWith(s)))).length;
  return hits >= Math.min(2, words.length);
}

export type RowState = 'covered' | 'current' | 'next' | 'open' | 'skipped';
export interface AgendaRow { item: AgendaItem; state: RowState; coveredAtMs?: number }
export interface AgendaTrack {
  rows: AgendaRow[];
  current?: AgendaItem;
  /** 1-based place of the current item ("3 of 4"); every item once all are covered. */
  place: number;
  total: number;
  /** Time left on the current item, never below 0. */
  leftMs?: number;
  /** Share of the current item's minutes used, 0 to 1. */
  used?: number;
}

/**
 * The talk moves to an item once two lines mention it; the item before is then covered at its last mention.
 * The current item is the furthest one the talk moved to, else the first open one; its clock starts at its first mention.
 */
export function trackAgenda(agenda: Pick<Agenda, 'items'>, segments: Segment[], nowMs: number): AgendaTrack {
  const items = agenda.items;
  const lines = segments.filter((s) => !s.interim && s.text.trim()).sort((a, b) => a.startMs - b.startMs);
  const hits = items.map((item) => lines.filter((s) => mentions(item, s.text)).map((s) => s.startMs));
  const moved = hits.map((h) => (h.length >= 2 ? h[1] : undefined));

  const coveredAt = items.map((item, i): number | undefined => {
    if (item.coveredAtMs !== undefined) return item.coveredAtMs;
    const own = hits[i]!;
    if (own.length < 2 || item.skipped) return undefined; // one passing mention does not cover an item
    const laterStart = items
      .map((_, j) => (j > i && moved[j] !== undefined && hits[j]![0]! > own[0]! ? hits[j]![0]! : undefined))
      .filter((t): t is number => t !== undefined);
    if (!laterStart.length) return undefined;
    const until = Math.min(...laterStart);
    const before = own.filter((t) => t < until);
    return before.length ? before[before.length - 1] : own[0];
  });

  const open = (i: number) => !items[i]!.skipped && coveredAt[i] === undefined;
  let current = -1;
  for (let i = items.length - 1; i >= 0; i--) if (open(i) && moved[i] !== undefined) { current = i; break; }
  if (current < 0) current = items.findIndex((_, i) => open(i));

  const rows: AgendaRow[] = items.map((item, i) => {
    if (item.skipped) return { item, state: 'skipped' };
    const at = coveredAt[i];
    if (at !== undefined) return { item, state: 'covered', coveredAtMs: at };
    if (i === current) return { item, state: 'current' };
    return { item, state: current >= 0 && i > current && !openBetween(items, coveredAt, current, i) ? 'next' : 'open' };
  });

  const total = items.length;
  if (current < 0) return { rows, place: total, total };
  const item = items[current]!;
  const started = hits[current]![0] ?? Math.max(0, ...coveredAt.filter((t): t is number => t !== undefined));
  const budget = Math.max(0, item.minutes) * 60_000;
  const spent = Math.max(0, nowMs - started);
  return {
    rows, current: item, place: current + 1, total,
    leftMs: Math.max(0, budget - spent),
    used: budget ? Math.min(1, spent / budget) : 1,
  };
}

// "next" marks only the first open item after the current one.
function openBetween(items: AgendaItem[], coveredAt: (number | undefined)[], current: number, i: number): boolean {
  for (let j = current + 1; j < i; j++) if (!items[j]!.skipped && coveredAt[j] === undefined) return true;
  return false;
}

/** "2 min left" */
export function minutesLeft(leftMs: number): string {
  return `${Math.ceil(leftMs / 60_000)} min left`;
}

/** Marks an item skipped; nothing else changes. */
export function skipItem(agenda: Agenda, id: string): Agenda {
  return { ...agenda, items: agenda.items.map((i) => (i.id === id ? { ...i, skipped: true } : i)) };
}
