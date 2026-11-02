import { setVoiceover, voiceoverState } from './state';

/** What a take needs from the editor, taken when V is pressed. */
export interface TakeContext {
  startOut: number;
  endOut: number;
  /** The preview's playhead, output ms. */
  playhead(): number;
  seek(out: number): void;
  play(): void;
  pause(): void;
  /** Called once with the finished take; rejects are logged. */
  save(blob: Blob, take: Take): Promise<void>;
}

/** Output ms [from, to) the take was said over, and the take-file ms heard at `from`. */
export interface Take { ms: number; from: number; to: number; fileAt: number }

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
// Set while the mic prompt is open, so a second V does not ask twice.
let starting = false;

/** Presses of V while a take runs stop it. */
export const stopTake = (): void => live?.stop();
export const cancelTake = (): void => live?.cancel();

/** "Allow mic" with nothing to record over: asks for the mic and lets it go. */
export async function askForMic(mic: MicDeps = browserMic): Promise<void> {
  try {
    (await mic.getStream()).getTracks().forEach((t) => t.stop());
    setVoiceover({ phase: 'idle' });
  } catch (error) {
    console.error('Klipkord: could not open the microphone', error);
    setVoiceover({ phase: 'no-mic' });
  }
}

const COUNT = 3;
const TICK_MS = 80;

/** The ms between the preview being drawn and the sound being heard, and the mic's own delay. */
function latencyMs(audio: AudioContext | null, track: MediaStreamTrack | undefined): number {
  const out = (audio?.baseLatency ?? 0) + (audio?.outputLatency ?? 0);
  const input = (track?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;
  return Math.max(0, (out + input) * 1000);
}

/**
 * Counts in (when on), records the range with the preview playing, saves the take as a file for the project.
 * The take is placed by the playhead: where it stood as the recorder's first data came in, less the speaker and mic
 * delay, to where it stood at Stop.
 */
export async function startTake(ctx: TakeContext, mic: MicDeps = browserMic): Promise<void> {
  if (live || starting) return;
  starting = true;
  let stream: MediaStream;
  try {
    stream = await mic.getStream();
  } catch (error) {
    starting = false;
    console.error('Klipkord: could not open the microphone', error);
    setVoiceover({ phase: 'no-mic' });
    return;
  }
  starting = false;
  // A take that began while the prompt was open keeps its own stream.
  if (live) { stream.getTracks().forEach((t) => t.stop()); return; }
  const total = Math.max(0, ctx.endOut - ctx.startOut);
  const track = stream.getAudioTracks()[0];
  let cancelled = false;
  let done = false;
  let timer = 0;
  let recorder: MediaRecorder | null = null;
  let audio: AudioContext | null = null;
  const chunks: Blob[] = [];
  let started = 0;
  // Output ms heard at take-file ms 0, from the playhead at the first data.
  let outAtZero: number | null = null;

  const finish = (save: boolean) => {
    if (done) return false;
    done = true;
    window.clearInterval(timer);
    window.removeEventListener('beforeunload', leave);
    stream.getTracks().forEach((t) => t.stop());
    void audio?.close().catch(() => undefined);
    ctx.pause();
    live = null;
    setVoiceover({ phase: 'idle', count: 0, elapsed: 0, level: 0 });
    return save;
  };
  // Closing the tab while a take records loses it: Chrome asks first.
  const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', leave);

  live = {
    stop: () => {
      if (recorder?.state === 'recording') recorder.stop();
      else { cancelled = true; finish(false); }
    },
    cancel: () => {
      cancelled = true;
      if (recorder?.state === 'recording') { recorder.onstop = null; recorder.stop(); }
      finish(false);
    },
  };
  setVoiceover({ phase: voiceoverState().countIn ? 'counting' : 'recording', count: COUNT, elapsed: 0, total, rangeFrom: ctx.startOut, rangeTo: ctx.endOut, level: 0, mic: track?.label ?? '' });
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
  const lag = latencyMs(audio, track);

  try {
    const rec = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : undefined);
    recorder = rec;
    rec.onstart = () => { started = mic.now(); };
    rec.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      if (outAtZero === null && started > 0) outAtZero = ctx.playhead() - (mic.now() - started) - lag;
      chunks.push(e.data);
    };
    rec.onerror = (e) => {
      console.error('Klipkord: the voiceover recorder failed', e);
      rec.onstop = null;
      finish(false);
    };
    if (track) track.onended = () => { if (rec.state === 'recording') rec.stop(); else finish(false); };
    rec.onstop = () => {
      const stopOut = Math.min(ctx.endOut, ctx.playhead());
      const ms = started > 0 ? Math.round(mic.now() - started) : 0;
      if (!finish(true) || chunks.length === 0 || ms < 200) return;
      const zero = outAtZero ?? stopOut - ms - lag;
      const from = Math.max(ctx.startOut, zero), to = Math.min(stopOut, zero + ms);
      if (to - from < 200) return;
      ctx.save(new Blob(chunks, { type: 'audio/webm' }), { ms, from, to, fileAt: from - zero })
        .catch((error: unknown) => console.error('Klipkord: could not save the voiceover', error));
    };
    rec.start(500);
  } catch (error) {
    console.error('Klipkord: could not start the voiceover recorder', error);
    finish(false);
    return;
  }
  setVoiceover({ phase: 'recording' });
  ctx.play();
  timer = window.setInterval(() => {
    const elapsed = Math.max(0, ctx.playhead() - ctx.startOut);
    let level = 0;
    if (meter) {
      meter.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      level = Math.min(1, Math.sqrt(sum / data.length) * 4);
    }
    setVoiceover({ elapsed: Math.min(elapsed, total), level });
    // The playhead ends the take; the wall clock only stops one whose preview stalled.
    if (total > 0 && (ctx.endOut - ctx.playhead() < TICK_MS / 2 || (started > 0 && mic.now() - started > total + 2000))) live?.stop();
  }, TICK_MS);
}
