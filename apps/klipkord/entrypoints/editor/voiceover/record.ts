import { setVoiceover, voiceoverState } from './state';

/** What a take needs from the editor, taken when V is pressed. */
export interface TakeContext {
  startOut: number;
  endOut: number;
  seek(out: number): void;
  play(): void;
  pause(): void;
  /** Called once with the finished take and how long it ran; rejects are logged. */
  save(blob: Blob, ms: number, startOut: number): Promise<void>;
}

export interface MicDeps {
  getStream(): Promise<MediaStream>;
  now(): number;
}

const browserMic: MicDeps = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } }),
  now: () => performance.now(),
};

interface Live { stop(): void; cancel(): void }
let live: Live | null = null;

/** Presses of V while a take runs stop it. */
export const stopTake = (): void => live?.stop();
export const cancelTake = (): void => live?.cancel();

const COUNT = 3;
const TICK_MS = 80;

/** Counts in (when on), records the range with the preview playing, saves the take as a file for the project. */
export async function startTake(ctx: TakeContext, mic: MicDeps = browserMic): Promise<void> {
  if (live) return;
  const total = Math.max(0, ctx.endOut - ctx.startOut);
  let stream: MediaStream;
  try {
    stream = await mic.getStream();
  } catch (error) {
    console.error('Klipkord: could not open the microphone', error);
    setVoiceover({ phase: 'no-mic' });
    return;
  }
  const label = stream.getAudioTracks()[0]?.label ?? '';
  let cancelled = false;
  let timer = 0;
  let recorder: MediaRecorder | null = null;
  let audio: AudioContext | null = null;
  const chunks: Blob[] = [];
  let started = 0;

  const finish = (save: boolean) => {
    window.clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void audio?.close().catch(() => undefined);
    ctx.pause();
    live = null;
    setVoiceover({ phase: 'idle', count: 0, elapsed: 0, level: 0 });
    return save;
  };

  live = {
    stop: () => {
      if (recorder?.state === 'recording') recorder.stop();
      else if (voiceoverState().phase === 'counting') { cancelled = true; finish(false); }
    },
    cancel: () => {
      cancelled = true;
      if (recorder?.state === 'recording') { recorder.onstop = null; recorder.stop(); }
      finish(false);
    },
  };
  setVoiceover({ phase: voiceoverState().countIn ? 'counting' : 'recording', count: COUNT, elapsed: 0, total, rangeFrom: ctx.startOut, rangeTo: ctx.endOut, level: 0, mic: label });
  ctx.pause();
  ctx.seek(ctx.startOut);

  if (voiceoverState().countIn) {
    for (let n = COUNT; n > 0; n--) {
      setVoiceover({ count: n });
      await new Promise((r) => setTimeout(r, 1000));
      if (cancelled) return;
    }
  }

  let meter: AnalyserNode | null = null;
  try {
    audio = new AudioContext();
    meter = audio.createAnalyser();
    meter.fftSize = 256;
    audio.createMediaStreamSource(stream).connect(meter);
  } catch (error) {
    console.error('Klipkord: could not read the mic level', error);
  }
  const data = new Uint8Array(meter?.fftSize ?? 0);

  recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.onstop = () => {
    const ms = Math.round(mic.now() - started);
    finish(true);
    if (chunks.length === 0 || ms < 200) return;
    ctx.save(new Blob(chunks, { type: 'audio/webm' }), ms, ctx.startOut).catch((error: unknown) => console.error('Klipkord: could not save the voiceover', error));
  };
  started = mic.now();
  recorder.start(500);
  setVoiceover({ phase: 'recording' });
  ctx.play();
  timer = window.setInterval(() => {
    const elapsed = mic.now() - started;
    let level = 0;
    if (meter) {
      meter.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      level = Math.min(1, Math.sqrt(sum / data.length) * 4);
    }
    setVoiceover({ elapsed, level });
    if (total > 0 && elapsed >= total) live?.stop();
  }, TICK_MS);
}
