// Loads a brief from local data (cached events, memory, saved agenda) for the side panel and the brief tab.
import { useCallback, useEffect, useState } from 'react';
import { listMeetings } from '@/lib/db';
import { suggestAgenda } from '@/lib/memory/agenda';
import { buildBrief, type Brief } from '@/lib/memory/brief';
import { getAgenda, listItems, listPeople, putAgenda } from '@/lib/memory/store';
import type { Agenda } from '@/lib/memory/types';
import { cachedEvents, lastTime } from '@/lib/reminders';
import type { CalendarEvent } from '@/lib/types';
import { nearMeeting } from '../../components/v4/recordBar';
import { world } from '../../components/v4/world';
import type { Meetings } from './loops';

export interface BriefView { ready: boolean; brief?: Brief; agenda?: Agenda; saved: boolean; lastTime?: string[]; meetings?: Meetings }

/** The named event, else the meeting about to start, else the next one in the cached 24 hours. */
export function pickEvent(events: CalendarEvent[], now: number, eventId?: string): CalendarEvent | undefined {
  if (eventId) return events.find((e) => e.id === eventId);
  return nearMeeting(events, now) ?? events.filter((e) => e.start > now).sort((a, b) => a.start - b.start)[0];
}

export async function loadBrief(eventId: string | undefined, now: number): Promise<Omit<BriefView, 'lastTime'>> {
  const events = world.events ?? (await cachedEvents(now));
  const event = pickEvent(events, now, eventId);
  if (!event) return { ready: true, saved: false };
  const [people, items, meetings, stored] = await Promise.all([listPeople(), listItems(), listMeetings(), getAgenda(event.id)]);
  const brief = buildBrief({ event, people, items, meetings, now });
  const agenda = stored ?? suggestAgenda(event, brief.rows.map((r) => r.item), now);
  return { ready: true, brief, agenda, saved: !!stored, meetings: new Map(meetings.map((m) => [m.id, m])) };
}

export function useBrief(eventId?: string): [BriefView, () => void] {
  const [view, setView] = useState<BriefView>({ ready: false, saved: false });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadBrief(eventId, world.now());
      if (!alive) return;
      setView(loaded);
      if (loaded.brief?.last) {
        const lines = await lastTime(loaded.brief);
        if (alive) setView((v) => ({ ...v, lastTime: lines }));
      }
    })().catch((error) => console.error('Rekord: could not load the brief', error));
    return () => { alive = false; };
  }, [eventId, tick]);
  return [view, reload];
}

/** Saves the agenda the person records with (their click). */
export const saveAgenda = (agenda: Agenda) => putAgenda(agenda);
