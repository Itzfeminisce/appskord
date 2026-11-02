import { useEffect, useState } from 'react';
import { EVENTS_FILE } from '@/lib/events';
import type { Project, RecEvent } from '@/lib/project/types';
import { videoStore, type Track, type VideoStore } from '@/lib/videoStore';

/** The recording's events, for zooms on clicks; empty without an events track. */
export async function loadEvents(recordingId: string, store: VideoStore = videoStore): Promise<RecEvent[]> {
  try {
    const file = await store.read(recordingId, EVENTS_FILE as Track);
    if (file.size === 0) return [];
    return (JSON.parse(await file.text()) as { events: RecEvent[] }).events;
  } catch (error) {
    console.error('Klipkord: could not read the events', error);
    return [];
  }
}

/** Events once read; undefined while reading. A project without an events track has none. */
export function useEvents(project: Project): RecEvent[] | undefined {
  const [events, setEvents] = useState<RecEvent[] | undefined>(project.events ? undefined : []);
  const { id, events: has } = project;
  useEffect(() => {
    if (!has) { setEvents([]); return; }
    let live = true;
    void loadEvents(id).then((e) => { if (live) setEvents(e); });
    return () => { live = false; };
  }, [id, has]);
  return events;
}
