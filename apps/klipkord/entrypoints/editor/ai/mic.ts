import { SAMPLE_RATE } from '@/lib/transcribe/chunker';
import { transcribeGroq } from '@/lib/transcribe/groq';

/** Records the mic until `stop`, then sends the words to Groq's speech model (the v2 transcribe path). */
export async function hear(key: string): Promise<{ stop(): Promise<string>; cancel(): void }> {
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
        const heard = await transcribeGroq(audio.getChannelData(0), { key });
        return heard.text.trim();
      } finally {
        void context.close();
      }
    },
  };
}
