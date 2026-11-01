import type { LocalAvailability } from './path';

/** The parts of Chrome's Web Speech API Motikord uses. Only ever on-device (processLocally); never Chrome's cloud speech. */
export interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean; processLocally?: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
interface RecognitionClass {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<LocalAvailability>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

function recognitionClass(): RecognitionClass | undefined {
  const g = globalThis as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

/** 'unavailable' whenever Chrome can't promise on-device recognition for this language. */
export async function localAvailability(lang: string): Promise<LocalAvailability> {
  const R = recognitionClass();
  if (!R?.available || !('processLocally' in R.prototype)) return 'unavailable';
  try {
    return await R.available({ langs: [lang], processLocally: true });
  } catch {
    return 'unavailable';
  }
}

/** Downloads the language once (voice-getting-ready). Call inside the click. */
export async function installLocal(lang: string): Promise<boolean> {
  const R = recognitionClass();
  if (!R?.install) return false;
  try {
    return await R.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  }
}

export function createLocalRecognition(lang: string): Recognition | undefined {
  const R = recognitionClass();
  if (!R) return undefined;
  const r = new R();
  r.lang = lang;
  r.continuous = true;
  r.interimResults = true;
  r.processLocally = true;
  // Refuse rather than fall back to Chrome's cloud speech.
  if (r.processLocally !== true) return undefined;
  return r;
}
