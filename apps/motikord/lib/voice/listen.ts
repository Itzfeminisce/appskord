/** Pure rules for a listening session (FRAMES.md "Voice prompts"). */

export const PAUSE_MS = 3_000;      // "Motikord stops when you pause for 3 seconds."
export const NOT_HEARD_MS = 8_000;  // voice-not-heard: "Nothing was heard for 8 seconds."
export const MAX_MS = 120_000;      // a prompt is a sentence or two; long takes stop by themselves
export const LEVEL_BARS = 15;
export const SOUND_LEVEL = 0.08;    // 0..1 RMS-ish level counted as speech

export type ListenStep = 'continue' | 'finish' | 'not-heard';

export function nextStep({ elapsedMs, heard, sinceSoundMs }: { elapsedMs: number; heard: boolean; sinceSoundMs: number }): ListenStep {
  if (!heard) return elapsedMs >= NOT_HEARD_MS ? 'not-heard' : 'continue';
  if (sinceSoundMs >= PAUSE_MS || elapsedMs >= MAX_MS) return 'finish';
  return 'continue';
}

/** "0:07" */
export function formatTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Puts heard words at the cursor without replacing typed text; returns the new text and where the cursor ends up. */
export function insertWords(text: string, cursor: number, words: string): { text: string; cursor: number } {
  const w = words.trim();
  const at = Math.max(0, Math.min(cursor, text.length));
  if (!w) return { text, cursor: at };
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const out = `${before}${lead}${w}${trail}${after}`;
  return { text: out, cursor: before.length + lead.length + w.length };
}

/** Joins the recognised pieces: final results settle, the rest are still being heard. */
export function joinResults(results: { transcript: string; isFinal: boolean }[]): { settled: string; interim: string } {
  const tidy = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean).join(' ');
  return { settled: tidy(results.filter((r) => r.isFinal).map((r) => r.transcript)), interim: tidy(results.filter((r) => !r.isFinal).map((r) => r.transcript)) };
}

/** Which StatesVoice card a microphone failure shows. */
export type MicProblem = 'voice-mic-blocked' | 'voice-no-mic';
export function micProblem(errorName: string | undefined): MicProblem {
  return errorName === 'NotAllowedError' || errorName === 'SecurityError' || errorName === 'not-allowed' ? 'voice-mic-blocked' : 'voice-no-mic';
}

/** Chrome's site settings page for this extension (voice-mic-blocked "Open Chrome settings"). */
export const chromeSiteSettingsUrl = (extensionId: string) => `chrome://settings/content/siteDetails?site=${encodeURIComponent(`chrome-extension://${extensionId}`)}`;

/** Lets the mic tab tell open Motikord pages that Chrome's answer came in. */
export const MIC_CHANNEL = 'motikord-mic';
export type MicMessage = { granted: boolean };
