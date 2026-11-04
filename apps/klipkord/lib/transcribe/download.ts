import { BASE_MODEL, Whisper, summarize, track, type FileProgress } from './whisper';

/** Loads the base Whisper model into the browser cache, reporting bytes; `job.stop` cancels it. */
export async function downloadModel(job: { stop: () => void }, onBytes: (loaded: number, total: number) => void): Promise<void> {
  const files = new Map<string, FileProgress>();
  const whisper = new Whisper(() => new Worker(new URL('../../entrypoints/offscreen/whisper.worker.ts', import.meta.url), { type: 'module' }));
  job.stop = () => whisper.terminate();
  whisper.onProgress = (p) => {
    track(files, p);
    const { loaded, total } = summarize(files.values(), 0);
    onBytes(loaded, total);
  };
  try {
    await whisper.load(BASE_MODEL);
  } finally {
    whisper.terminate();
  }
}
