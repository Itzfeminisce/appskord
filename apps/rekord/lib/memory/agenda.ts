// Agenda build: suggested items from open loops and the invite, minutes and totals. Pure; no I/O.
import type { CalendarEvent } from '../types';
import { isoDay } from './rank';
import type { Agenda, AgendaItem, MemoryItem } from './types';

/** The source tags the frames draw. */
export const SOURCE_LABEL: Record<AgendaItem['source'], string> = {
  invite: 'From the invite', promise: 'Open promise', question: 'Open question', you: 'Added by you',
};

// Leading verbs a promise starts with; the agenda names the thing, not the task.
const VERBS = /^(send|share|get|give|write|book|update|make|finish|prepare|review|draft|deliver|bring|set up|put together)\s+/i;

/** "Send the revised pricing deck" → "Revised pricing deck". */
export function topicOf(text: string): string {
  const rest = text.trim().replace(VERBS, '').replace(/^(the|your|our|my)\s+/i, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** List lines in the invite ("- Northwind rollout date", "1. Pricing"). */
export function inviteTopics(description: string | undefined): string[] {
  return (description ?? '')
    .split('\n')
    .map((l) => /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(l)?.[1]?.trim())
    .filter((t): t is string => !!t);
}

export const eventMinutes = (event: Pick<CalendarEvent, 'start' | 'end'>) => Math.max(0, Math.round((event.end - event.start) / 60_000));

/** Minutes the items take. */
export const agendaMinutes = (items: AgendaItem[]) => items.filter((i) => !i.skipped).reduce((sum, i) => sum + Math.max(0, i.minutes), 0);

/** "4 items · 25 of 30 min" */
export function agendaLine(agenda: Pick<Agenda, 'items' | 'totalMinutes'>): string {
  const n = agenda.items.length;
  return `${n} ${n === 1 ? 'item' : 'items'} · ${agendaMinutes(agenda.items)} of ${agenda.totalMinutes} min`;
}

/** Things owed to you come first, then what you owe, then open questions. A late promise you owe gets 10 minutes. */
export function suggestAgenda(event: CalendarEvent, loops: MemoryItem[], now: number): Agenda {
  const today = isoDay(now);
  const rank = (i: MemoryItem) => (i.kind === 'question' ? 2 : i.ownerId === 'me' ? 1 : 0);
  const sorted = [...loops].sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt);
  const items: AgendaItem[] = sorted.map((i) => ({
    id: `a-${i.id}`,
    text: topicOf(i.text),
    source: i.kind === 'question' ? 'question' : 'promise',
    minutes: i.kind === 'promise' && i.ownerId === 'me' && !!i.due && i.due < today ? 10 : 5,
  }));
  inviteTopics(event.description).forEach((text, n) => items.push({ id: `a-invite-${n}`, text, source: 'invite', minutes: 5 }));
  return { meetingKey: event.id, items, totalMinutes: eventMinutes(event) };
}

/** The goal typed on a first-meeting brief becomes item one. */
export function withGoal(agenda: Agenda, goal: string): Agenda {
  const text = goal.trim();
  const rest = agenda.items.filter((i) => i.id !== GOAL_ID);
  return { ...agenda, items: text ? [{ id: GOAL_ID, text, source: 'you', minutes: 5 }, ...rest] : rest };
}
export const GOAL_ID = 'a-goal';

/** Moves the item at `from` to `to`. */
export function moveItem(items: AgendaItem[], from: number, to: number): AgendaItem[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
