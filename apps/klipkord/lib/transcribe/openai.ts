/** OpenAI speech-to-text on `/audio/transcriptions`, in the same chunks as Groq. Sends audio only. Never logs or returns the key. */
import type { FetchLike } from '@/lib/llm';
import { postSpeech, speechForm, SpeechError, type SpeechOptions } from './groq';
import type { Heard } from './merge';

export const OPENAI_SPEECH_MODEL = 'gpt-transcribe';

/** Transcribes one 16 kHz chunk. Word times are asked for; a model that refuses them is asked once more for text only. Throws SpeechError. */
export async function transcribeOpenAI(audio: Float32Array, opts: SpeechOptions, fetchFn: FetchLike = (u, i) => fetch(u, i)): Promise<Heard> {
  if (!opts.key) throw new SpeechError('No OpenAI key is loaded.', 'no-key');
  const model = opts.model || OPENAI_SPEECH_MODEL;
  const timed = speechForm(audio, model, opts.language);
  timed.append('response_format', 'verbose_json');
  timed.append('timestamp_granularities[]', 'word');
  timed.append('timestamp_granularities[]', 'segment');
  try {
    return await postSpeech('openai', timed, opts, fetchFn);
  } catch (error) {
    if (!(error instanceof SpeechError) || error.code !== 'bad-request') throw error;
    const plain = speechForm(audio, model, opts.language);
    plain.append('response_format', 'json');
    return postSpeech('openai', plain, opts, fetchFn);
  }
}
