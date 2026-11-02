import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { listMeetings } from '@/lib/db';
import { listItems, listPeople } from '@/lib/memory/store';
import type { MemoryItem, Person } from '@/lib/memory/types';
import type { CalendarEvent, Meeting } from '@/lib/types';
import { useCalendar } from '../../components/CalendarCard';
import { world } from '../../components/v4/world';
import { avatarTint, initials } from './peopleView';
import './people.css';

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
export const BackArrow = () => <svg {...base} width="20" height="20"><path d="M15 5l-7 7 7 7" /></svg>;
export const MoreDots = () => (
  <svg {...base} width="20" height="20"><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></svg>
);
export const FindIcon = () => <svg {...base} width="18" height="18"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></svg>;
export const PairIcon = () => <svg {...base} width="20" height="20"><circle cx="9" cy="9" r="4" /><circle cx="16" cy="15" r="4" /></svg>;
export const ChevronIcon = () => <svg {...base} width="16" height="16"><path d="M9 6l6 6-6 6" /></svg>;
export const CalIcon = () => <svg {...base} width="20" height="20"><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>;
export const HandOffIcon = () => <svg {...base} width="16" height="16"><path d="M4 12h12M12 7l5 5-5 5" /></svg>;
export const DecisionIcon = () => <svg {...base} width="16" height="16"><path d="M12 3l9 9-9 9-9-9z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>;

/** Initials on a tint; dashed when the person has no email yet. */
export function Avatar({ person, size = 28, font = 11 }: { person: Person; size?: number; font?: number }) {
  const style: CSSProperties = person.email
    ? { ...avatarTint(person.name), width: size, height: size, fontSize: font }
    : { width: size, height: size, fontSize: font, border: '1.5px dashed #6E7079', background: 'transparent', color: '#44464D' };
  return <span className="pp-avatar" style={style} aria-hidden="true">{initials(person.name)}</span>;
}

export interface PeopleData { people: Person[]; items: MemoryItem[]; meetings: Meeting[] }

/** People, items and meetings, reloadable after a change. */
export function usePeopleData(): [PeopleData | undefined, () => void] {
  const [data, setData] = useState<PeopleData>();
  const load = useCallback(() => {
    Promise.all([listPeople(), listItems(), listMeetings()])
      .then(([people, items, meetings]) => setData({ people, items, meetings }))
      .catch((error) => console.error('Rekord: could not load people', error));
  }, []);
  useEffect(load, [load]);
  return [data, load];
}

export function useEvents(): CalendarEvent[] {
  const calendar = useCalendar();
  return world.events ?? (calendar.status === 'ready' ? calendar.events : []);
}

const NOT_SAME_KEY = 'rekord.people.notSame';
/** Pairs the user called different people, so they are not suggested again. */
export async function readNotSame(): Promise<string[]> {
  try {
    return ((await browser.storage.local.get(NOT_SAME_KEY))[NOT_SAME_KEY] as string[] | undefined) ?? [];
  } catch {
    return [];
  }
}
export async function addNotSame(key: string): Promise<void> {
  await browser.storage.local.set({ [NOT_SAME_KEY]: [...new Set([...(await readNotSame()), key])] });
}

export const refreshBadge = () => { browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined); };

/** One-shot message the People list shows on arrival ("Sarah is forgotten."). */
export const peopleFlash: { message?: string } = {};
