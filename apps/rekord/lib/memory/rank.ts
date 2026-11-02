import type { MemoryItem } from './types';

export type LoopSection = 'overdue' | 'today' | 'thisWeek' | 'noDate';
export type LoopTab = 'youOwe' | 'owedToYou' | 'questions';

export interface OpenLoops {
  sections: { id: LoopSection; items: MemoryItem[] }[];   // empty sections left out
  counts: Record<LoopTab, number>;
  overdue: number;                                          // toolbar badge
}

/** Local calendar date as 'YYYY-MM-DD'. */
export function isoDay(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isOpenLoop(item: MemoryItem, now: number): boolean {
  if (item.kind === 'decision') return false;
  if (item.status !== 'open' && item.status !== 'looksDone') return false;
  return !(item.snoozedUntil && item.snoozedUntil > now);
}

export function tabOf(item: MemoryItem): LoopTab {
  if (item.kind === 'question') return 'questions';
  return item.ownerId === 'me' ? 'youOwe' : 'owedToYou';
}

export function sectionOf(item: MemoryItem, now: number): LoopSection {
  if (!item.due) return 'noDate';
  const today = isoDay(now);
  if (item.due < today) return 'overdue';
  if (item.due === today) return 'today';
  // Anything later than today sits under This week, the last dated section.
  return 'thisWeek';
}

const byDue = (a: MemoryItem, b: MemoryItem) =>
  (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt;

/** Open loops for one tab (or all), in the Overdue, Today, This week, No date order. */
export function rankOpenLoops(items: MemoryItem[], now: number, tab?: LoopTab): OpenLoops {
  const open = items.filter((i) => isOpenLoop(i, now));
  const counts: Record<LoopTab, number> = { youOwe: 0, owedToYou: 0, questions: 0 };
  for (const i of open) counts[tabOf(i)]++;
  const shown = open.filter((i) => !tab || tabOf(i) === tab).sort(byDue);
  const order: LoopSection[] = ['overdue', 'today', 'thisWeek', 'noDate'];
  const sections = order
    .map((id) => ({ id, items: shown.filter((i) => sectionOf(i, now) === id) }))
    .filter((s) => s.items.length > 0);
  const overdue = open.filter((i) => i.kind === 'promise' && sectionOf(i, now) === 'overdue').length;
  return { sections, counts, overdue };
}
