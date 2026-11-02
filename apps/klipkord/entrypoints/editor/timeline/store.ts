import { useSyncExternalStore } from 'react';
import type { Clip } from '@/lib/project/types';

/** What can be selected on the timeline; one kind at a time. Chapters are selected by index, the rest by id. */
export type SelectKind = 'clips' | 'zooms' | 'overlays' | 'cards' | 'music' | 'media' | 'voiceovers' | 'chapters';
export interface Selected { kind: SelectKind; ids: string[] }

export type Dialog = 'cuts' | 'history' | 'shortcuts' | 'settings' | null;

/** Buttons whose panel belongs to a later task (Cards, Voiceover, AddMedia, MusicPicker); each registers itself. */
export type ExternalAction = 'text' | 'voiceover' | 'media' | 'music';

export interface TimelineState {
  selected: Selected | null;
  dialog: Dialog;
  /** Cuts menu: the current cut's name is being edited. */
  renaming: boolean;
  speedOpen: boolean;
  snap: boolean;
  clipboard: Clip[];
  actions: Partial<Record<ExternalAction, () => void>>;
}

const initial = (): TimelineState => ({ selected: null, dialog: null, renaming: false, speedOpen: false, snap: true, clipboard: [], actions: {} });

let state = initial();
const listeners = new Set<() => void>();

export const timelineState = (): TimelineState => state;

export function setTimeline(patch: Partial<TimelineState> | ((s: TimelineState) => Partial<TimelineState>)): void {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function subscribeTimeline(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** A new editor starts with nothing selected and no dialog open; registered actions and the clipboard stay. */
export function resetTimeline(): void {
  setTimeline((s) => ({ ...initial(), actions: s.actions, clipboard: s.clipboard, snap: s.snap }));
}

export function useTimeline(): TimelineState {
  return useSyncExternalStore(subscribeTimeline, timelineState, timelineState);
}

/** Later tasks hand the timeline their panel: `registerTimelineAction('media', openAddMedia)`. */
export function registerTimelineAction(name: ExternalAction, run: () => void): () => void {
  setTimeline((s) => ({ actions: { ...s.actions, [name]: run } }));
  return () => setTimeline((s) => {
    const { [name]: _gone, ...rest } = s.actions;
    void _gone;
    return { actions: rest };
  });
}

export const select = (selected: Selected | null) => setTimeline({ selected, speedOpen: false });
export const openDialog = (dialog: Dialog) => setTimeline({ dialog, speedOpen: false });
