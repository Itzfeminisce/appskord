import { useSyncExternalStore } from 'react';
import { DEFAULT_CLEANUP, type CleanupSettings } from '@/lib/project/cleanup';

/** What the transcript and the Clean up panel in the inspector share. */
export interface TranscriptUi {
  cleanup: boolean;
  settings: CleanupSettings;
  /** Finds unticked in the list, or clicked in the transcript to keep them. */
  off: ReadonlySet<string>;
  /** "Preview": playback skips the ticked finds. */
  previewing: boolean;
  /** SuggestedEdits asked for again, from PanelOpen's card. */
  quickWins: boolean;
}

const INITIAL: TranscriptUi = { cleanup: false, settings: DEFAULT_CLEANUP, off: new Set(), previewing: false, quickWins: false };

let state = INITIAL;
const listeners = new Set<() => void>();

export function setUi(patch: Partial<TranscriptUi> | ((s: TranscriptUi) => Partial<TranscriptUi>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

export const resetUi = () => setUi(INITIAL);

export function toggleOff(id: string) {
  setUi((s) => {
    const off = new Set(s.off);
    if (off.has(id)) off.delete(id); else off.add(id);
    return { off };
  });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useUi(): TranscriptUi {
  return useSyncExternalStore(subscribe, () => state);
}

/** PanelOpen's quick wins card leaves the recording id here for its editor tab to pick up. */
export const QUICK_WINS_KEY = 'klipkord.quickWins';
