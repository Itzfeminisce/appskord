import type { AiMode, Provider } from '../types';

/** What Chrome's on-device speech recognition says for a language (SpeechRecognition.available with processLocally). */
export type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

/** Providers whose speech-to-text Motikord can use with the same key. */
export type SpeechProvider = 'groq' | 'openai';
export const isSpeechProvider = (p: Provider): p is SpeechProvider => p === 'groq' || p === 'openai';

/** How speech becomes text, in FRAMES.md "Voice prompts" order. Chrome's cloud speech service is never a path. */
export type VoicePath =
  | { kind: 'local'; download: boolean }
  | { kind: 'cloud'; provider: SpeechProvider }
  | { kind: 'unavailable' };

export interface PathInputs { local: LocalAvailability; ai: AiMode; provider: Provider; hasKey: boolean }

export function chooseVoicePath({ local, ai, provider, hasKey }: PathInputs): VoicePath {
  if (local === 'available') return { kind: 'local', download: false };
  if (local === 'downloadable' || local === 'downloading') return { kind: 'local', download: true };
  // Built-in AI means nothing goes to a cloud provider, voice included.
  if (ai === 'cloud' && isSpeechProvider(provider) && hasKey) return { kind: 'cloud', provider };
  return { kind: 'unavailable' };
}
