/** Rekord's chat client for the summary provider, from `@appskord/llm`, with Rekord's own sentences. Never logs or returns a key. */
import { chatCloud, type ChatMessage, type ErrorText, type FetchLike } from '@appskord/llm';
import { loadKeys } from './penv';
import { getSettings, PROVIDERS, updateSettings } from './settings';
import { formatClock } from './time';
import type { Meeting, Segment, Settings } from './types';

export { LLMError, type ChatMessage, type FetchLike, type LLMErrorCode } from '@appskord/llm';

/** Best first. The first entry is Rekord's default Groq summary model; a retired model is re-picked from this list. */
export const GROQ_CHAT_PREFERENCE = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
];

export interface ChatOptions {
  json?: boolean;        // ask for a JSON object reply (response_format json_object)
  maxTokens?: number;
  temperature?: number;  // default 0.2
  signal?: AbortSignal;
  /** Settings and keys to use instead of storage (e.g. from `transcriber/config` in the offscreen document). */
  config?: { settings: Settings; keys: Record<string, string> };
  /** A typed model's test question: a gone model is reported, never swapped. */
  typed?: boolean;
}

const text: ErrorText = ({ reason, status }) => {
  if (reason === 'no-key') return 'Rekord needs an AI connection for this. Check Connect AI in Settings.';
  if (reason === 'offline' || reason === 'cancelled') return 'Rekord could not reach the AI service. Check your connection and try again.';
  if (reason === 'auth') return 'The AI service did not accept your key. Check Connect AI in Settings.';
  if (reason === 'busy') return 'The AI service is busy right now. Try again in a minute.';
  if (status) return `The AI service returned an error (${status}). Try again.`;
  return 'The AI service sent an unexpected reply. Try again.';
};

/** Saves a re-picked model over a retired one, unless the person changed the model meanwhile. */
async function saveRepick(failed: string, picked: string): Promise<void> {
  const current = await getSettings();
  if (current.summary.provider === 'groq' && current.summary.model === failed) {
    await updateSettings({ summary: { ...current.summary, model: picked, gone: failed } });
  }
}

/** Sends `messages` to the summary provider/model and returns the reply text. Throws LLMError. */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<string> {
  const [settings, keys] = opts.config
    ? [opts.config.settings, opts.config.keys]
    : await Promise.all([getSettings(), loadKeys()]);
  const { provider, model, baseUrl } = settings.summary;
  const keyName = PROVIDERS[provider].keyName;
  return chatCloud(messages, {
    app: 'Rekord',
    text,
    provider,
    baseUrl,
    // Anthropic goes through its OpenAI-compatible endpoint, as before.
    openaiCompatible: true,
    key: keyName ? keys[keyName] : undefined,
    model,
    // Groq retires models: pick a listed one, remember it, and retry once.
    modelGone: provider === 'groq' && !opts.typed ? 'repick' : 'report',
    preference: GROQ_CHAT_PREFERENCE,
    onRepick: opts.config || provider !== 'groq' ? undefined : (picked) => saveRepick(model, picked),
    json: opts.json,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    signal: opts.signal,
    fetch: fetchFn,
  });
}

/** What a speaker shows as: "You", their saved name, else "Speaker A" for a diarized label, else "Others". */
export function displayName(s: Pick<Segment, 'speaker' | 'speakerLabel'>, speakers?: Meeting['speakers']): string {
  if (s.speaker === 'you') return 'You';
  if (!s.speakerLabel) return 'Others';
  return speakers?.[s.speakerLabel]?.name?.trim() || `Speaker ${s.speakerLabel}`;
}

/** Display name for a segment (same as `displayName`). */
export const speakerName = displayName;

/** Transcript as "[mm:ss] Name: text" lines (empty segments skipped). */
export function transcriptLines(segments: Segment[], speakers?: Meeting['speakers']): string[] {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => `[${formatClock(s.startMs)}] ${speakerName(s, speakers)}: ${s.text.trim()}`);
}
