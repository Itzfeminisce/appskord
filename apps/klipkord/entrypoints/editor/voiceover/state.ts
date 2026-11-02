import { useSyncExternalStore } from 'react';

/** idle: nothing; counting: the count in; recording: the take; no-mic: the mic is blocked. */
export type Phase = 'idle' | 'counting' | 'recording' | 'no-mic';

export interface VoiceoverState {
  phase: Phase;
  /** The count in, 3 to 1. */
  count: number;
  /** ms recorded so far and ms the range allows. */
  elapsed: number;
  total: number;
  /** The range being recorded over, output ms. */
  rangeFrom: number;
  rangeTo: number;
  /** 0..1 of the mic. */
  level: number;
  mic: string;
  /** "Clean and level the voiceover" and "Count in 3 seconds"; both start on. */
  clean: boolean;
  countIn: boolean;
}

const SETTINGS = 'klipkord.voiceover';

function saved(): Pick<VoiceoverState, 'clean' | 'countIn'> {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Partial<VoiceoverState>;
    return { clean: v.clean ?? true, countIn: v.countIn ?? true };
  } catch {
    return { clean: true, countIn: true };
  }
}

let state: VoiceoverState = { phase: 'idle', count: 0, elapsed: 0, total: 0, rangeFrom: 0, rangeTo: 0, level: 0, mic: '', ...saved() };
const listeners = new Set<() => void>();

export const voiceoverState = (): VoiceoverState => state;
export const voiceoverBusy = (): boolean => state.phase === 'counting' || state.phase === 'recording';

export function setVoiceover(patch: Partial<VoiceoverState>): void {
  state = { ...state, ...patch };
  if ('clean' in patch || 'countIn' in patch) {
    try { localStorage.setItem(SETTINGS, JSON.stringify({ clean: state.clean, countIn: state.countIn })); } catch { /* Without storage the choice lasts until the tab closes. */ }
  }
  listeners.forEach((l) => l());
}

export function subscribeVoiceover(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export const useVoiceover = (): VoiceoverState => useSyncExternalStore(subscribeVoiceover, voiceoverState, voiceoverState);
