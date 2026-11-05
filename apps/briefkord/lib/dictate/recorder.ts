/** The microphone: Chrome's permission, one recording between two presses, and its level. Audio stays in memory until sent. */

export type MicState = 'granted' | 'prompt' | 'denied';

/** The extension's microphone permission, without asking. */
export async function micPermission(): Promise<MicState> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return 'prompt';
  }
}

/** Opens the mic; Chrome shows its prompt the first time (not in the side panel). Undefined when refused. */
export async function openMic(): Promise<MediaStream | undefined> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (error) {
    if ((error as { name?: string })?.name !== 'NotAllowedError') console.error('Briefkord: could not open the microphone', error);
    return undefined;
  }
}

/** Chrome's site settings for Briefkord, where a blocked mic is allowed again. */
export const micSettingsUrl = (): string => `chrome://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}`;

/** The message the mic tab sends the side panel once Chrome has answered. */
export const MIC_MESSAGE = 'briefkord-mic';
export interface MicMessage {
  type: typeof MIC_MESSAGE;
  allowed: boolean;
}

export class Recording {
  private chunks: Blob[] = [];
  private recorder: MediaRecorder;
  private context: AudioContext;
  private analyser: AnalyserNode;
  private bytes: Uint8Array<ArrayBuffer>;

  constructor(private stream: MediaStream) {
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.context = new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 64;
    this.context.createMediaStreamSource(stream).connect(this.analyser);
    this.bytes = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** The loudness across the voice range, 0 to 255 per bin. */
  level(): Uint8Array {
    this.analyser.getByteFrequencyData(this.bytes);
    return this.bytes.subarray(1, 19);
  }

  private release(): void {
    for (const t of this.stream.getTracks()) t.stop();
    void this.context.close().catch(() => undefined);
  }

  /** Stops the mic and hands back the audio once. */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
        this.chunks = [];
        resolve(blob);
      };
      if (this.recorder.state === 'inactive') this.recorder.onstop(new Event('stop'));
      else this.recorder.stop();
      this.release();
    });
  }

  /** Esc: stops the mic and throws the audio away. */
  discard(): void {
    this.recorder.ondataavailable = null;
    this.recorder.onstop = null;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
    this.release();
  }
}
