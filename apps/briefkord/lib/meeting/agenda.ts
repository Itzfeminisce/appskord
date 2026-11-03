/** The meeting's agenda in list order, where each card stands, and the time per section. Pure. */
import { cardLabel } from '../board/label';
import type { Board } from '../board/types';
import { durationText, overBy, spentIn, type Clock } from './clock';

export interface AgendaCard { id: string; title: string; number: number; index: number; section: string }
export interface AgendaSection { id: string; title: string; number: number; minutes: number; cards: AgendaCard[] }

/** Sections that hold cards, numbered by their place in the list ("2 · The flow"); each card with its list number. */
export function agenda(board: Board): AgendaSection[] {
  let index = 0;
  const out: AgendaSection[] = [];
  board.sections.forEach((s, i) => {
    const cards = s.cards.filter((id) => board.cards[id]).map((id) => ({ id, title: cardLabel(board.cards[id]!), number: index + 1, index: index++, section: s.id }));
    if (cards.length) out.push({ id: s.id, title: s.title, number: i + 1, minutes: s.minutes, cards });
  });
  return out;
}

export const agendaCards = (sections: readonly AgendaSection[]): AgendaCard[] => sections.flatMap((s) => s.cards);

export type Step = 'done' | 'current' | 'next';
export const stepOf = (index: number, current: number): Step => (index < current ? 'done' : index === current ? 'current' : 'next');

/** The meeting length: every section's minutes added up. */
export const plannedMinutes = (board: Board): number => board.sections.reduce((sum, s) => sum + s.minutes, 0);

export interface SectionTime { id: string; title: string; ms: number; overMs: number; time: string; label: string }

/** MeetingEnd tiles: "5:40" "The flow", or over time "6:35" "Decisions · 1:35 over". */
export function sectionTimes(sections: readonly AgendaSection[], clock: Clock, now: number): SectionTime[] {
  return sections.map((s) => {
    const ms = spentIn(clock, s.id, now);
    const overMs = overBy(ms, s.minutes);
    return { id: s.id, title: s.title, ms, overMs, time: durationText(ms), label: overMs > 0 ? `${s.title} · ${durationText(overMs)} over` : s.title };
  });
}

/** "7 cards in 14:20, planned 15 min. Your notes and the board are saved on this computer." */
export function endLine(cards: number, ms: number, planned: number): string {
  const count = `${cards} ${cards === 1 ? 'card' : 'cards'} in ${durationText(ms)}`;
  return `${count}${planned > 0 ? `, planned ${planned} min` : ''}. Your notes and the board are saved on this computer.`;
}
