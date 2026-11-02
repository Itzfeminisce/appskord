import { EVENTS_FILE } from '@/lib/events';
import type { EventsTrack, Project, Source } from '@/lib/project/types';
import type { RenderSource } from '@/lib/render/render.worker';
import { videoStore, type Track, type VideoStore } from '@/lib/videoStore';

export interface LoadedMedia {
  /** Each source's file by source id; a missing file is left out. */
  blobs: Map<string, Blob>;
  /** Sources whose file is gone from OPFS (media-missing). */
  missing: Source[];
  events?: EventsTrack;
}

// read() opens any file under the recording's folder by name, so source files and events.json go through it too.
const readFile = (store: VideoStore, id: string, name: string, type?: string) => store.read(id, name as Track, type);

/** Opens every source of the project and its events track from OPFS. */
export async function loadMedia(project: Project, store: VideoStore = videoStore): Promise<LoadedMedia> {
  const blobs = new Map<string, Blob>();
  const missing: Source[] = [];
  await Promise.all(project.sources.map(async (source) => {
    try {
      const blob = await readFile(store, project.id, source.file, source.mime);
      if (blob.size > 0) blobs.set(source.id, blob);
      else missing.push(source);
    } catch (error) {
      console.error('Klipkord: could not open source', error);
      missing.push(source);
    }
  }));
  let events: EventsTrack | undefined;
  if (project.events) {
    try {
      const file = await readFile(store, project.id, EVENTS_FILE);
      if (file.size > 0) events = JSON.parse(await file.text()) as EventsTrack;
    } catch (error) {
      console.error('Klipkord: could not open events', error);
    }
  }
  return { blobs, missing, events };
}

/** What the render worker needs: the video and image sources it can draw. */
export function renderSources(project: Project, blobs: Map<string, Blob>): RenderSource[] {
  return project.sources.flatMap((s) => {
    const blob = blobs.get(s.id);
    if (!blob) return [];
    const image = s.mime.startsWith('image/');
    return s.video || image ? [{ id: s.id, blob, image }] : [];
  });
}

/** Clicks in a recording's events track, for the side panel's Saved line; 0 without one. */
export async function countClicks(recordingId: string, store: VideoStore = videoStore): Promise<number> {
  try {
    const file = await readFile(store, recordingId, EVENTS_FILE);
    if (file.size === 0) return 0;
    return (JSON.parse(await file.text()) as EventsTrack).events.filter((e) => e.type === 'click').length;
  } catch (error) {
    console.error('Klipkord: could not count clicks', error);
    return 0;
  }
}
