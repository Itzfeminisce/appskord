import { useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { EditorSlots } from '../Editor';
import { DepsContext } from '../deps';
import { ExportVideo, saveThumbnail, type ExportPlan } from '../dialogs/ExportVideo';
import { GifExport, type GifPlan } from '../dialogs/GifExport';
import { ShareLink } from '../dialogs/ShareLink';
import { ThumbnailPicker } from '../dialogs/ThumbnailPicker';
import { clock } from '../format';
import { loadMedia } from '../media';
import { StateCard } from '../states/StateCard';
import { loadBrand } from '../story/brand';
import { Btn } from '../timeline/controls';
import { actionButton, C, MONO } from '../ui';
import type { SlotProps } from './slots';
import { getFolderHandle } from '@/lib/db';
import { DriveError } from '@/lib/drive';
import ExportWorker from '@/lib/export/export.worker?worker';
import { connectGoogle, getGoogleToken } from '@/lib/googleAuth';
import { remaining, sizeText, timeLeft, uploadLeft } from '@/lib/export/estimate';
import { extraFiles, sibling } from '@/lib/export/files';
import type { Job, Target, TitleStyle } from '@/lib/export/protocol';
import type { DriveShare } from '@/lib/export/share';
import { ensureAccess, writeFile } from '@/lib/folder';
import { captionLines, type Caption } from '@/lib/project/captions';
import type { Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import { units } from '@/lib/wordCuts';

const LINK_ICON = <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>;

/** One finished export in the "Done" list. */
export interface DoneItem {
  key: string; name: string; file: Blob; size: number;
  /** “Full” · 5:48 · 1080p, for ShareLink's "Uploaded" line. */
  label: string;
  share?: DriveShare;
  /** Where it was saved: null for the Downloads folder. */
  folder: string | null;
}

export type FailKind = 'memory' | 'disk' | 'other';

export interface Thumb { out: number; title: string; style: TitleStyle; camera: boolean }

interface Active { title: string; done: number; total: number; lengthMs: number; started: number; cancel(): void }

export interface ExportState {
  dialog: 'export' | 'thumbnail' | 'gif' | 'share' | null;
  thumb: Thumb | null;
  running: Active | null;
  cardOpen: boolean;
  failed: { pct: number; kind: FailKind; retry: (fast: boolean) => void } | null;
  upload: { pct: number; left: string | null; cancel(): void } | null;
  /** `release` lets the kept file go once the card is answered. */
  uploadFailed: { said: string; item: DoneItem; release?: () => void } | null;
  done: DoneItem[];
  toast: DoneItem | null;
  share: DoneItem | null;
}

const initial = (): ExportState => ({
  dialog: null, thumb: null, running: null, cardOpen: true, failed: null, upload: null, uploadFailed: null, done: [], toast: null, share: null,
});

let state = initial();
const listeners = new Set<() => void>();
export const getExport = (): ExportState => state;
export function setExport(patch: Partial<ExportState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const useExport = (): ExportState => useSyncExternalStore(subscribe, getExport);
export const openExport = (dialog: ExportState['dialog']) => setExport({ dialog });
/** Tests start from a clean store. */
export const resetExport = (): void => setExport(initial());

/** Everything outside React an export reaches; tests swap parts. */
export interface ExportDeps {
  worker(): Worker;
  loadMedia: typeof loadMedia;
  /** The v2 save folder, when one is set and Chrome still lets Klipkord write there (asks from the click). */
  folder(): Promise<FileSystemDirectoryHandle | null>;
  download(file: Blob, name: string): void;
  show(file: Blob): void;
  copy(text: string): Promise<void>;
  token(interactive: boolean): Promise<string | undefined>;
  fetch: typeof fetch;
  denoise(): Promise<(ctx: BaseAudioContext) => Promise<AudioNode>>;
}

const urlFor = (file: Blob) => {
  const url = URL.createObjectURL(file);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  return url;
};

export const exportDeps: ExportDeps = {
  worker: () => new ExportWorker(),
  loadMedia,
  async folder() {
    try {
      const handle = await getFolderHandle();
      return handle && (await ensureAccess(handle, true)) ? handle : null;
    } catch (error) {
      console.error('Klipkord: could not open the save folder', error);
      return null;
    }
  },
  download(file, name) {
    const a = document.createElement('a');
    a.href = urlFor(file);
    a.download = name;
    a.click();
  },
  show: (file) => { window.open(urlFor(file), '_blank'); },
  copy: (text) => navigator.clipboard.writeText(text),
  async token(interactive) {
    // connectGoogle needs the click's user gesture, so nothing is awaited before it.
    if (interactive) return (await getGoogleToken()) ?? connectGoogle();
    return getGoogleToken();
  },
  fetch: (...args) => fetch(...args),
  denoise: async () => (await import('@/lib/audio/denoise')).denoise,
};

/** A name not yet used in the folder: "a.mp4", then "a (2).mp4". */
async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  for (let n = 1; ; n++) {
    const next = n === 1 ? name : `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    try { await dir.getFileHandle(next); } catch (error) {
      if ((error as { name?: string }).name === 'NotFoundError') return next;
      throw error;
    }
  }
}

let chain: Promise<unknown> = Promise.resolve();
let opfsSeq = 0;
let swept: Promise<void> | null = null;

const EXPORTS = 'exports';
// Chrome reads a download from the kept file after the click; 10 minutes covers the largest export.
const HOLD_MS = 10 * 60_000;

/** Exports kept in the extension's storage, by DoneItem key: removed once no download, upload or card needs them. */
const keptFiles = new Map<string, { uses: number; discard(): Promise<void> }>();

/** Marks a kept file in use; the returned function ends that use. Null when the file is already gone. */
function use(key: string): (() => void) | null {
  const k = keptFiles.get(key);
  if (!k) return null;
  k.uses++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (--k.uses > 0) return;
    keptFiles.delete(key);
    void k.discard();
    // Its File no longer reads, so it leaves the Done list.
    setExport({ done: state.done.filter((d) => d.key !== key), toast: state.toast?.key === key ? null : state.toast });
  };
}

/** Keeps the file through its download, then lets it go. */
function afterDownload(key: string): void {
  const release = use(key);
  if (release) setTimeout(release, HOLD_MS);
}

const failKind = (error: unknown): FailKind => {
  const text = `${(error as { name?: string })?.name ?? ''} ${String((error as Error)?.message ?? error)}`;
  if (/QuotaExceeded|no space|disk.*full|out of space/i.test(text)) return 'disk';
  return /memory|allocat/i.test(text) ? 'memory' : 'other';
};

const words = (rec: Recording) => rec.transcript.flatMap((s) => s.words ?? []);
const captionsOf = (rec: Recording, project: Project): Caption[] => captionLines(units(rec.transcript), project.wordFixes);

/** Saves a small file next to the video: into the folder, or as a download. */
async function saveSmall(dir: FileSystemDirectoryHandle | null, name: string, data: Blob | string): Promise<void> {
  if (dir) await writeFile(dir, await freeName(dir, name), data);
  else exportDeps.download(typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data, name);
}

/** A still of `out` as JPEG (ThumbnailPicker and the saved thumbnail). */
export async function renderStill(p: Pick<SlotProps, 'project' | 'recording'>, job: Omit<Extract<Job, { kind: 'still' }>, 'kind' | 'project' | 'sources' | 'events' | 'captions'> & { burn: boolean },
  media?: Awaited<ReturnType<typeof loadMedia>>): Promise<Blob | null> {
  const { runJob } = await import('@/lib/export/run');
  const { renderSources } = await import('../media');
  const m = media ?? (await exportDeps.loadMedia(p.project));
  const r = runJob({ ...job, kind: 'still', project: p.project, sources: renderSources(p.project, m.blobs), events: m.events,
    captions: job.burn ? captionsOf(p.recording, p.project) : undefined, brand: await loadBrand(job.cut) }, { worker: exportDeps.worker() });
  return (await r.done)?.file ?? null;
}

/** Starts the video export now, or after the one running. */
export function startExport(p: SlotProps, plan: ExportPlan, dir: FileSystemDirectoryHandle | null): void {
  setExport({ dialog: null, failed: null, cardOpen: true });
  chain = chain.then(() => runExport(p, plan, dir)).catch((error: unknown) => console.error('Klipkord: could not export', error));
}

interface Out {
  target: Target;
  name: string;
  /** The kept file's key when it waits in the extension's storage for a download. */
  opfs?: string;
  /** Removes the unfinished file after a cancel or a failure. */
  discard(): Promise<void>;
}

async function target(dir: FileSystemDirectoryHandle | null, name: string): Promise<Out> {
  if (dir) {
    const free = await freeName(dir, name);
    const discard = () => dir.removeEntry(free).catch((error: unknown) => console.error('Klipkord: could not remove an unfinished export', error));
    return { target: { kind: 'handle', handle: await dir.getFileHandle(free, { create: true }) }, name: free, discard };
  }
  const { browserStore, drop, hold, stamped, sweep } = await import('@/lib/export/opfs');
  swept ??= sweep(browserStore, EXPORTS);
  await swept;
  const opfs = stamped(browserStore, ++opfsSeq, name);
  const release = await hold(browserStore, EXPORTS, opfs);
  const discard = () => drop(browserStore, EXPORTS, opfs, release);
  keptFiles.set(opfs, { uses: 0, discard });
  return {
    target: { kind: 'opfs', name: opfs }, opfs, name,
    discard: () => { keptFiles.delete(opfs); return discard(); },
  };
}

async function runExport(p: SlotProps, plan: ExportPlan, dir: FileSystemDirectoryHandle | null): Promise<void> {
  const { runJob, renderCut, cutAudio } = await import('@/lib/export/run');
  const { renderSources } = await import('../media');
  const { project, recording } = p;
  const cut = renderCut(p.cut, { shape: plan.shape, burn: plan.burn });
  const media = await exportDeps.loadMedia(project);
  const audio = await cutAudio(project, cut, words(recording), media.blobs, exportDeps.denoise)
    .catch((error: unknown) => {
      console.error('Klipkord: could not mix the sound', error);
      return null;
    });
  const main = await target(dir, plan.name);
  let audioOnly: Out | null = null;
  let r!: ReturnType<typeof runJob>;
  try {
    // A cut with no sound gets no M4A.
    audioOnly = plan.audioOnly && audio ? await target(dir, sibling(plan.name, 'm4a')) : null;
    const job: Job = {
      kind: 'video', project, cut, captions: plan.burn ? captionsOf(recording, project) : undefined, events: media.events,
      sources: renderSources(project, media.blobs), width: plan.width, height: plan.height, fps: plan.fps, container: plan.container,
      bitrate: plan.bitrate, hardware: plan.hardware, audio: !!audio, target: main.target, audioOnly: audioOnly?.target, brand: await loadBrand(cut),
    };
    const started = performance.now();
    r = runJob(job, {
      worker: exportDeps.worker(), audio: audio?.chunks,
      onProgress: (done, total) => { if (state.running) setExport({ running: { ...state.running, done, total } }); },
    });
    setExport({ running: { title: plan.title, done: 0, total: 1, lengthMs: plan.lengthMs, started, cancel: r.cancel } });
  } catch (error) {
    audio?.dispose();
    await Promise.all([main.discard(), audioOnly?.discard()]);
    throw error;
  }
  let result: Awaited<typeof r.done> = null;
  try {
    result = await r.done;
  } catch (error) {
    const s = state.running;
    const pct = s ? Math.floor((100 * s.done) / Math.max(1, s.total)) : 0;
    setExport({ failed: { pct, kind: failKind(error), retry: (fast) => startExport(p, fast ? plan.fast() : plan, dir) } });
  } finally {
    audio?.dispose();
    setExport({ running: null });
  }
  if (!result) {
    await Promise.all([main.discard(), audioOnly?.discard()]);
    return;
  }
  const item: DoneItem = { key: main.opfs ?? main.name, name: main.name, file: result.file, size: result.file.size, label: plan.label, folder: dir?.name ?? null };
  if (!dir) {
    exportDeps.download(result.file, main.name);
    afterDownload(item.key);
    if (result.audio && audioOnly?.opfs) {
      exportDeps.download(result.audio, audioOnly.name);
      afterDownload(audioOnly.opfs);
    } else await audioOnly?.discard();
  }
  setExport({ done: [item, ...state.done], toast: item });
  if (plan.drive) void shareItem(item, false);
  try {
    for (const f of extraFiles(project, cut, captionsOf(recording, project), main.name, plan)) await saveSmall(dir, f.name, new Blob([f.data], { type: f.type }));
    if (plan.thumbnail) {
      const still = await renderStill(p, { ...plan.thumbnail, cut: renderCut(plan.thumbnail.cut, { burn: plan.burn }), burn: plan.burn }, media);
      if (still) await saveSmall(dir, sibling(main.name, 'jpg'), still);
    }
  } catch (error) {
    console.error('Klipkord: could not save the files beside the export', error);
  }
}

/** Makes the GIF from the rendered frames, then saves it. */
export function startGif(p: SlotProps, plan: GifPlan, dir: FileSystemDirectoryHandle | null): void {
  setExport({ dialog: null, failed: null, cardOpen: true });
  chain = chain.then(async () => {
    const { runJob, renderCut } = await import('@/lib/export/run');
    const { renderSources } = await import('../media');
    const cut = renderCut(p.cut, {});
    const media = await exportDeps.loadMedia(p.project);
    const main = await target(dir, plan.name);
    let r!: ReturnType<typeof runJob>;
    try {
    r = runJob({
      kind: 'gif', project: p.project, cut, captions: captionsOf(p.recording, p.project), events: media.events, sources: renderSources(p.project, media.blobs),
      width: plan.width, height: plan.height, fps: plan.fps, from: plan.from, to: plan.to, target: main.target, brand: await loadBrand(cut),
    }, { worker: exportDeps.worker(), onProgress: (done, total) => { if (state.running) setExport({ running: { ...state.running, done, total } }); } });
    setExport({ running: { title: plan.title, done: 0, total: 1, lengthMs: plan.to - plan.from, started: performance.now(), cancel: r.cancel } });
    } catch (error) {
      await main.discard();
      throw error;
    }
    let result: Awaited<typeof r.done> = null;
    try {
      result = await r.done;
    } catch (error) {
      console.error('Klipkord: could not make the GIF', error);
      const s = state.running;
      setExport({ failed: { pct: s ? Math.floor((100 * s.done) / Math.max(1, s.total)) : 0, kind: failKind(error), retry: () => startGif(p, plan, dir) } });
    } finally {
      setExport({ running: null });
    }
    if (!result) {
      await main.discard();
      return;
    }
    const item: DoneItem = { key: main.opfs ?? main.name, name: main.name, file: result.file, size: result.file.size, label: plan.label, folder: dir?.name ?? null };
    if (!dir) {
      exportDeps.download(result.file, main.name);
      afterDownload(item.key);
    }
    setExport({ done: [item, ...state.done], toast: item });
  }).catch((error: unknown) => console.error('Klipkord: could not make the GIF', error));
}

/** Copy link / Drive link: uploads the finished export once, then copies its link and shows ShareLink. */
export async function shareItem(item: DoneItem, interactive: boolean): Promise<void> {
  if (item.share) {
    await exportDeps.copy(item.share.link).catch(() => undefined);
    setExport({ share: item, dialog: 'share' });
    return;
  }
  // A folder export is not kept by Klipkord; a kept one stays until the upload ends.
  const release = item.folder === null ? use(item.key) : () => undefined;
  if (!release) return;
  try {
    await upload(item, interactive);
  } finally {
    release();
  }
}

async function upload(item: DoneItem, interactive: boolean): Promise<void> {
  let token: string | undefined;
  try {
    token = await exportDeps.token(interactive);
  } catch (error) {
    console.error('Klipkord: could not connect Google Drive', error);
  }
  if (!token) {
    setExport({ share: item, dialog: 'share' });
    return;
  }
  const { shareExport, googleSaid } = await import('@/lib/export/share');
  const abort = new AbortController();
  const started = performance.now();
  state.uploadFailed?.release?.();
  setExport({ uploadFailed: null, cardOpen: true, upload: { pct: 0, left: null, cancel: () => abort.abort() } });
  try {
    const share = await shareExport({ fetch: exportDeps.fetch }, token, item.file, item.name, (sent) => {
      const secs = remaining(sent, item.size, performance.now() - started);
      setExport({ upload: { pct: Math.floor((100 * sent) / Math.max(1, item.size)), left: secs === null ? null : uploadLeft(secs), cancel: () => abort.abort() } });
    }, abort.signal);
    const shared = { ...item, share };
    setExport({ done: state.done.map((d) => (d.key === item.key ? shared : d)), share: shared, dialog: 'share', toast: state.toast?.key === item.key ? shared : state.toast });
    await exportDeps.copy(share.link).catch(() => undefined);
  } catch (error) {
    if (abort.signal.aborted) return;
    console.error('Klipkord: could not upload to Drive', error);
    if (error instanceof DriveError && error.status === 401) setExport({ share: item, dialog: 'share' });
    else setExport({ uploadFailed: { said: googleSaid(error), item, release: use(item.key) ?? undefined } });
  } finally {
    setExport({ upload: null });
  }
}

const card = { position: 'fixed', right: 12, top: 56, zIndex: 16, width: 330, borderRadius: 12, background: C.panel, border: `1px solid ${C.line}`,
  boxShadow: '0 18px 44px rgba(0,0,0,0.55)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, color: C.text } as const;

/** The top bar pill: "Exporting 62%"; a click shows or hides the card. */
export function ExportingPill() {
  const s = useExport();
  if (!s.running) return null;
  const pct = Math.floor((100 * s.running.done) / Math.max(1, s.running.total));
  return (
    <button type="button" onClick={() => setExport({ cardOpen: !s.cardOpen })}
      style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 10px', borderRadius: 999, background: C.raised, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 12, color: C.secondary, cursor: 'pointer' }}>
      <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${C.accentText}`, borderRightColor: 'transparent', boxSizing: 'border-box', animation: 'kk-spin 0.9s linear infinite' }} />
      {`Exporting ${pct}%`}
    </button>
  );
}

function DoneRow({ item }: { item: DoneItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 44, height: 26, borderRadius: 4, background: 'linear-gradient(135deg, #1E3A8A, #3B82F6)', flexShrink: 0 }} />
      <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span title={item.name} style={{ fontSize: 12.5, fontWeight: 500, maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
        <span style={{ fontSize: 11.5, color: C.muted }}>Saved · {sizeText(item.size)}</span>
      </span>
      <Btn onClick={() => exportDeps.show(item.file)}>Show</Btn>
      <Btn icon={LINK_ICON} onClick={() => void shareItem(item, true)}>Copy link</Btn>
    </div>
  );
}

/** The Exporting card under the pill: progress, Cancel, Drive upload, failures and the Done list. */
const FAILED_BODY: Record<FailKind, string> = {
  memory: 'Chrome ran out of memory. Close other tabs or use Fast.',
  disk: 'This computer ran out of space.',
  other: 'Something went wrong while making the video. Your project is fine.',
};

export function ExportingCard() {
  const s = useExport();
  // Free up space opens the side panel's Storage; the editor's deps are absent only in tests.
  const deps = useContext(DepsContext);
  useTick(!!s.running);
  const busy = s.running || s.upload || s.failed || s.uploadFailed;
  if (!busy || !s.cardOpen) return null;
  const r = s.running;
  const pct = r ? Math.floor((100 * r.done) / Math.max(1, r.total)) : 0;
  const secs = r ? remaining(r.done, r.total, performance.now() - r.started) : null;
  return (
    <div role="status" style={card}>
      {r && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{r.title}</span>
          <button type="button" onClick={r.cancel} style={{ ...actionButton('ghost'), height: 26 }}><span>Cancel</span></button>
        </div>
        <span style={{ height: 6, borderRadius: 3, background: C.line, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, borderRadius: 3, background: C.accentText }} />
        </span>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.secondary }}>
          <span>{secs === null ? `${pct}%` : `${pct}% · ${timeLeft(secs)}`}</span>
          <span style={{ fontFamily: MONO }}>{clock((r.lengthMs * r.done) / Math.max(1, r.total))} of {clock(r.lengthMs)}</span>
        </div>
      </>}
      {s.failed && (
        <StateCard state="export-failed" compact title={`Export stopped at ${s.failed.pct}%`}
          body={FAILED_BODY[s.failed.kind]}
          actions={s.failed.kind === 'disk'
            ? [{ label: 'Free up space', tone: 'primary', onClick: () => deps?.openPanel('Storage') }, { label: 'Try again', tone: 'secondary', onClick: () => s.failed?.retry(false) }]
            : [{ label: 'Try again', tone: 'primary', onClick: () => s.failed?.retry(false) }, { label: 'Try with Fast', tone: 'secondary', onClick: () => s.failed?.retry(true) }]} />
      )}
      {s.upload && (
        <StateCard state="drive-uploading" compact title={`Uploading to Drive · ${s.upload.pct}%`}
          body={`${s.upload.left ? `${s.upload.left} ` : ''}You can keep editing.`}
          actions={[{ label: 'Cancel', tone: 'ghost', onClick: () => s.upload?.cancel() }]} />
      )}
      {s.uploadFailed && (
        <StateCard state="drive-failed" compact title="Couldn't upload to Drive"
          body={`The video is saved on this computer. Google said: ${s.uploadFailed.said}.`}
          actions={[{ label: 'Try again', tone: 'primary', onClick: () => { const f = s.uploadFailed!; setExport({ uploadFailed: null }); void shareItem(f.item, true); f.release?.(); } },
            { label: 'Open', tone: 'secondary', onClick: () => exportDeps.show(s.uploadFailed!.item.file) }]} />
      )}
      {s.done.length > 0 && <>
        <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Done</span>
        {s.done.slice(0, 4).map((d) => <DoneRow key={d.key} item={d} />)}
      </>}
      {r && <span style={{ fontSize: 11.5, color: C.muted }}>Keep this tab open until it finishes. Edits you make now go into your next export.</span>}
    </div>
  );
}

/** Redraws once a second while `on`, so "time left" keeps moving between progress messages. */
function useTick(on: boolean): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

/** export-done: "Exported · Invite your team.mp4". */
function DoneToast({ item }: { item: DoneItem }) {
  useEffect(() => {
    const t = setTimeout(() => { if (getExport().toast?.key === item.key) setExport({ toast: null }); }, 8000);
    return () => clearTimeout(t);
  }, [item.key]);
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 17, width: 360 }}>
      <StateCard state="export-done" role="status" title={item.folder ? `Saved to ${item.folder}.` : `Exported · ${item.name}`}
        body={item.folder ? `${sizeText(item.size)} in ${item.folder}.` : `${sizeText(item.size)} in your Downloads folder.`}
        style={{ boxShadow: '0 18px 44px rgba(0,0,0,0.55)' }}
        actions={[{ label: 'Open', tone: 'secondary', onClick: () => exportDeps.show(item.file) },
          { label: 'Copy link', tone: 'secondary', icon: LINK_ICON, onClick: () => void shareItem(item, true) }]} />
    </div>
  );
}

/** export-leave: Chrome asks before the tab closes while an export or upload runs. */
function useLeaveGuard(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [on]);
}

/** T9's dialogs, card and toast over the editor. */
export function ExportLayer(p: SlotProps) {
  const s = useExport();
  useLeaveGuard(!!s.running || !!s.upload);
  return (
    <>
      <style>{'@keyframes kk-spin{to{transform:rotate(360deg)}}'}</style>
      <ExportingCard />
      {s.toast && !s.share && <DoneToast item={s.toast} />}
      {s.dialog === 'export' && <ExportVideo p={p} onClose={() => openExport(null)} onStart={(plan, dir) => startExport(p, plan, dir)} />}
      {s.dialog === 'thumbnail' && <ThumbnailPicker p={p} thumb={s.thumb} onBack={() => openExport('export')} onUse={(thumb) => { saveThumbnail(); setExport({ thumb, dialog: 'export' }); }} />}
      {s.dialog === 'gif' && <GifExport p={p} onBack={() => openExport('export')} onClose={() => openExport(null)} onStart={(plan, dir) => startGif(p, plan, dir)} />}
      {s.dialog === 'share' && s.share && <ShareLink item={s.share} onClose={() => setExport({ dialog: null, share: null })} />}
    </>
  );
}

/** Plugged into the editor shell: the Export button, the pill and the layer. */
export const exportSlots: Pick<EditorSlots, 'topBar' | 'overlay'> = {
  topBar: () => ({ onExport: () => openExport('export'), status: <ExportingPill /> }),
  overlay: ExportLayer,
};

