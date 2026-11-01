import { creditsText } from './credits';
import { deleteExportJob, getDB, listExportJobs, putExportJob, updateClip } from './db';
import type { MixedAudio } from './encode/audio';
import { exportRecipe, planExport, secondsLeft, type ExportChoice, type RenderItem } from './exportPlan';
import { CREDITS_FILE } from './fileNames';
import { FolderAccessLost, uniqueDir, writeFile, type SavedFile } from './folder';
import { send } from './messages';
import type { ExportJob, Recipe } from './types';

/** The job row plus how far it got, so Recovered can say "stopped at 46%", and a heartbeat that tells a live export from a dead one. */
export type StoredJob = ExportJob & { percent?: number; beatAt?: number };
export interface JobChoice extends ExportChoice { credits: boolean }

const BEAT_MS = 2000;
export const STALE_MS = 15000;

export function newJob(clipId: string, c: JobChoice, now: number, id: string = crypto.randomUUID()): StoredJob {
  return { id, clipId, kinds: c.kinds, aspects: c.aspects, quality: c.quality, credits: c.credits, startedAt: now, status: 'running', percent: 0, beatAt: now };
}
export const jobChoice = (j: ExportJob): JobChoice => ({ kinds: j.kinds, aspects: j.aspects, quality: j.quality, credits: j.credits });

/**
 * Running jobs whose page stopped beating were cut off (Chrome closed, tab closed); they become 'interrupted'.
 * Returns every interrupted job, newest first. A job still beating belongs to an editor tab that is exporting now.
 */
export async function findInterrupted(now: number, staleMs = STALE_MS, clearBadge: () => void = () => void send({ type: 'export/progress', percent: null })): Promise<StoredJob[]> {
  const tx = (await getDB()).transaction('exportJobs', 'readwrite');
  const running = (await tx.store.index('status').getAll('running')) as StoredJob[];
  const dead = running.filter((j) => now - (j.beatAt ?? j.startedAt) > staleMs);
  await Promise.all([...dead.map((j) => tx.store.put({ ...j, status: 'interrupted' })), tx.done]);
  // A cut-off export left its percent on the toolbar icon; keep it only while another export is still live.
  if (dead.length && dead.length === running.length) clearBadge();
  return ((await listExportJobs('interrupted')) as StoredJob[]).reverse();
}

/** "Not now" on Recovered: forget the job; the clip itself is untouched. */
export const dismissJob = (id: string) => deleteExportJob(id);

// ---- One export run in the editor page ----

export type Phase = 'running' | 'done' | 'cancelled' | 'disk-full' | 'failed' | 'access-lost';
export interface ItemState { item: RenderItem; status: 'waiting' | 'running' | 'done'; percent: number; bytes?: number }
export interface Session {
  job: StoredJob; recipe: Recipe; items: ItemState[]; index: number;
  frame: number; frames: number; tMs: number; preview?: ImageBitmap; hardware?: boolean;
  percent: number; secondsLeft: number; phase: Phase; failedKind?: RenderItem['kind'];
  dir?: string; saved: SavedFile[]; playUrl?: string;
}

/** What renders one file; the page backs it with the export worker, tests with a fake encoder. */
export interface RenderHooks { progress(frame: number, frames: number, tMs: number, preview?: ImageBitmap): void; encoder(hardware: boolean): void }
export interface RenderRun { done: Promise<Blob>; cancel(): void }
export interface RunDeps {
  root: FileSystemDirectoryHandle;
  render(recipe: Recipe, item: RenderItem, audio: MixedAudio | undefined, hooks: RenderHooks): RenderRun;
  mix(recipe: Recipe, item: RenderItem): Promise<MixedAudio | undefined>;
  badge(percent: number | null): void;
  now(): number;
  saveJob?(job: StoredJob): Promise<void>;
  removeJob?(id: string): Promise<void>;
  markExported?(clipId: string, files: { file: string; bytes: number; at: number }[]): Promise<void>;
  objectUrl?(blob: Blob): string;
}

let session: Session | undefined;
let cancelNow: (() => void) | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<Session>) => { if (session) { session = { ...session, ...patch }; emit(); } };

export const getSession = () => session;
export function subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); }
/** Test helper and "Export another size": forget the finished run. */
export function clearSession() { if (session?.playUrl) URL.revokeObjectURL?.(session.playUrl); session?.preview?.close?.(); session = undefined; cancelNow = undefined; emit(); }

/** Cancel on Rendering: stops the worker; the run removes partial files and ends with phase 'cancelled'. */
export function cancelExport() { cancelNow?.(); }

/** Errors become the states in StatesExport: out of space, folder access gone, or the export stopped. */
export function classify(error: unknown): 'cancelled' | 'disk-full' | 'access-lost' | 'failed' {
  const e = error as { name?: string; message?: string; reason?: string };
  if (e?.name === 'Cancelled' || e?.reason === 'cancelled') return 'cancelled';
  if (e?.name === 'QuotaExceededError' || /quota|no space|disk is full/i.test(e?.message ?? '')) return 'disk-full';
  if (error instanceof FolderAccessLost || e?.name === 'NotAllowedError' || e?.name === 'SecurityError') return 'access-lost';
  return 'failed';
}

class CancelledRun extends Error { constructor() { super('Export cancelled'); this.name = 'Cancelled'; } }

/**
 * Renders every planned file one after another into a new sub-folder of the chosen folder, then credits.txt.
 * The ExportJob is written at the start and removed at the end, whatever the outcome; partial files are removed.
 * Removing the job or marking the clip happens after the files are safe, so neither can undo a finished export.
 */
export async function runExport(recipe: Recipe, clipId: string, choice: JobChoice, deps: RunDeps, jobId?: string): Promise<Session> {
  const saveJob = deps.saveJob ?? ((j) => putExportJob(j));
  const removeJob = deps.removeJob ?? deleteExportJob;
  const markExported = deps.markExported ?? (async (id, files) => {
    await updateClip(id, (c) => ({ exportedAt: deps.now(), exports: [...(c.exports ?? []), ...files] }));
  });
  const job = newJob(clipId, choice, deps.now(), jobId);
  const items = planExport(recipe, choice);
  const total = items.reduce((n, it) => n + it.frames, 0);
  const drawn = exportRecipe(recipe);
  session = { job, recipe, items: items.map((item) => ({ item, status: 'waiting', percent: 0 })), index: 0, frame: 0, frames: items[0]?.frames ?? 0, tMs: 0, percent: 0, secondsLeft: 0, phase: 'running', saved: [] };
  emit();

  let stop = false;
  let current: RenderRun | undefined;
  cancelNow = () => { stop = true; current?.cancel(); };
  let lastBeat = -Infinity;
  let beating: Promise<void> = Promise.resolve();
  const beat = (force = false) => {
    const t = deps.now();
    if (!force && t - lastBeat < BEAT_MS) return;
    lastBeat = t;
    job.percent = session?.percent ?? 0;
    job.beatAt = t;
    beating = saveJob({ ...job }).catch((error: unknown) => console.error('Motikord: could not save the export job', error));
  };
  // Long steps with no frames (decoding music, picking the encoder) still beat, so start-up never calls them interrupted.
  const ticker = setInterval(() => beat(true), BEAT_MS);

  let dirName: string | undefined;
  let blobForPlayer: Blob | undefined;
  try {
    await saveJob(job);
    deps.badge(0);
    dirName = await uniqueDir(deps.root, recipe.name);
    const dir = await deps.root.getDirectoryHandle(dirName, { create: true });
    set({ dir: dirName });
    let audio: MixedAudio | undefined;
    let mixed = false;
    let before = 0;
    for (let i = 0; i < items.length; i++) {
      if (stop) throw new CancelledRun();
      const item = items[i]!;
      const states = session!.items.map((s, k) => (k === i ? { ...s, status: 'running' as const } : s));
      set({ index: i, items: states, frame: 0, frames: item.frames, tMs: 0, hardware: undefined });
      if (item.audio && !mixed) {
        beat(true);
        audio = await deps.mix(recipe, item);
        mixed = true;
        beat(true);
        if (stop) throw new CancelledRun();
      }
      const started = deps.now();
      current = deps.render(drawn, item, item.audio ? audio : undefined, {
        encoder: (hardware) => { set({ hardware }); beat(true); },
        progress: (frame, frames, tMs, preview) => {
          // A frame that arrives after Cancel or the end is dropped, and its bitmap freed.
          if (stop || session?.phase !== 'running') { preview?.close?.(); return; }
          const percent = ((before + frame) / total) * 100;
          const left = secondsLeft(deps.now() - started, frame, frames, items.slice(i + 1));
          if (preview) session.preview?.close?.();
          set({ frame, frames, tMs, percent, secondsLeft: left, items: session.items.map((s, k) => (k === i ? { ...s, percent: (frame / frames) * 100 } : s)), ...(preview ? { preview } : {}) });
          deps.badge(percent);
          beat();
        },
      });
      if (stop) current.cancel();
      const blob = await current.done;
      current = undefined;
      if (stop) throw new CancelledRun();
      const saved = await writeFile(dir, item.file, blob);
      if (stop) throw new CancelledRun();
      blobForPlayer ??= blob;
      before += item.frames;
      set({ saved: [...session!.saved, saved], items: session!.items.map((s, k) => (k === i ? { ...s, status: 'done', percent: 100, bytes: saved.size } : s)) });
    }
    if (choice.credits) {
      if (stop) throw new CancelledRun();
      const credits = await writeFile(dir, CREDITS_FILE, creditsText(recipe));
      if (stop) throw new CancelledRun();
      set({ saved: [...session!.saved, credits] });
    }
    // From here the files are safe: Cancel can no longer remove them.
    cancelNow = undefined;
    clearInterval(ticker);
    const at = deps.now();
    await markExported(clipId, session!.saved.filter((f) => f.name !== CREDITS_FILE).map((f) => ({ file: `${dirName}/${f.name}`, bytes: f.size, at })))
      .catch((error: unknown) => console.error('Motikord: could not mark the clip exported', error));
    session?.preview?.close?.();
    set({ phase: 'done', percent: 100, secondsLeft: 0, preview: undefined, playUrl: blobForPlayer && (deps.objectUrl ?? URL.createObjectURL)(blobForPlayer) });
  } catch (error) {
    const phase = classify(stop ? new CancelledRun() : error);
    if (phase !== 'cancelled') console.error('Motikord: could not export the clip', error);
    current?.cancel();
    // No half-made export is left in the folder.
    if (dirName) await deps.root.removeEntry(dirName, { recursive: true }).catch(() => undefined);
    session?.preview?.close?.();
    set({ phase, failedKind: items[session?.index ?? 0]?.kind, saved: [], dir: undefined, preview: undefined });
  } finally {
    cancelNow = undefined;
    clearInterval(ticker);
    await beating;
    await removeJob(job.id).catch((error: unknown) => console.error('Motikord: could not remove the export job', error));
    deps.badge(null);
  }
  return session!;
}
