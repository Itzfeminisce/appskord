import { SAMPLE_RATE } from '@/lib/transcribe/chunker';
import { transcribeCloud } from '@/lib/transcribe/full';
import type { Heard } from '@/lib/transcribe/merge';
import { Whisper } from '@/lib/transcribe/whisper';
import type { Speech } from './deps';

async function whisperHere(audio: Float32Array, model: string): Promise<Heard> {
  const whisper = new Whisper(() => new Worker(new URL('../../offscreen/whisper.worker.ts', import.meta.url), { type: 'module' }));
  try {
    await whisper.load(model);
    return await whisper.transcribe(audio);
  } finally {
    whisper.terminate();
  }
}

/** Records the mic until `stop`, then turns the audio into words with the Transcripts pick: its cloud provider, or Whisper here. */
export async function hear(speech: Speech): Promise<{ stop(): Promise<string>; cancel(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const parts: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
  recorder.start();
  const end = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
  };
  return {
    cancel: end,
    async stop() {
      end();
      await done;
      const context = new AudioContext({ sampleRate: SAMPLE_RATE });
      try {
        const audio = await context.decodeAudioData(await new Blob(parts).arrayBuffer());
        const voice = audio.getChannelData(0);
        const heard = speech.provider === 'local'
          ? await whisperHere(voice, speech.model)
          : await transcribeCloud(speech.provider, voice, { key: speech.key, model: speech.model });
        return heard.text.trim();
      } finally {
        void context.close();
      }
    },
  };
}
