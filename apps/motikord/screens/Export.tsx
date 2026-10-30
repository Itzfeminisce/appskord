import { useEffect, useState, type CSSProperties } from 'react';
import { Button, IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { getFolderHandle } from '../lib/db';
import { pageDeps } from '../lib/encode/page';
import { clearSession, getSession, runExport, type JobChoice } from '../lib/exportJob';
import { ASPECTS, creditsBox, estimateLine, exportButton, planExport } from '../lib/exportPlan';
import { youllGet } from '../lib/fileNames';
import { chooseFolder, ensureAccess } from '../lib/folder';
import type { Aspect, FileKind, Quality, Recipe } from '../lib/types';
import { CloseIcon, DialogShell, useSettings, useStoredClip } from './MediaSearch';
import { CreditLocked, ExportCancelled, FolderAccessLost, FolderNotPicked, TypeNotes } from './StatesExport';

const KINDS: [FileKind, string, string][] = [
  ['mp4', 'MP4', 'Plays everywhere'],
  ['webm', 'WebM', 'Smaller files, for the web'],
  ['gif', 'GIF', 'Short loops for chats and docs. No sound.'],
  ['webm-alpha', 'See-through WebM', 'No background, for other editors'],
];
const SIZE_USE: Record<Aspect, string> = { '9:16': 'Stories, Reels, Shorts', '1:1': 'Feeds and posts', '16:9': 'YouTube, slides, websites' };

// "Export as WebM" on export-failed opens this screen on WebM.
let nextKind: FileKind | undefined;
export const openExportAs = (kind: FileKind) => { nextKind = kind; };

type FolderState = { state: 'loading' } | { state: 'none' } | { state: 'ok' | 'lost'; handle: FileSystemDirectoryHandle };

/** The saved folder ready to write, asking Chrome again from this click when it withdrew access. Undefined when not allowed. */
export async function folderFromClick(): Promise<FileSystemDirectoryHandle | undefined> {
  const handle = await getFolderHandle() ?? await chooseFolder();
  if (!handle) return undefined;
  return (await ensureAccess(handle, true)) ? handle : undefined;
}

/** Starts the run in this page; Rendering follows it. */
export function beginExport(recipe: Recipe, clipId: string, choice: JobChoice, root: FileSystemDirectoryHandle, jobId?: string) {
  clearSession();
  void runExport(recipe, clipId, choice, pageDeps(root), jobId);
}

const radio = (on: boolean): CSSProperties => ({ padding: '10px 12px', borderRadius: 10, border: on ? '2px solid var(--accent)' : '1px solid #E0E0E4', background: on ? 'var(--tint)' : 'var(--surface)', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' });
const legend: CSSProperties = { fontSize: 13, fontWeight: 600, padding: 0, marginBottom: 8 };
const box = { accentColor: 'var(--accent)', margin: 0, width: 16, height: 16 } as const;

export default function Export() {
  const { clipId, recipe, close } = useStoredClip();
  const { navigate } = useRouter();
  const settings = useSettings();
  const [kind, setKind] = useState<FileKind>();
  const [aspects, setAspects] = useState<Aspect[]>();
  const [quality, setQuality] = useState<Quality>();
  const [credits, setCredits] = useState<boolean>();
  const [folder, setFolder] = useState<FolderState>({ state: 'loading' });
  const [lockNote, setLockNote] = useState(false);
  const [toast, setToast] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Cancel on Rendering comes back here with export-cancelled.
    const s = getSession();
    if (s?.phase === 'cancelled') { setToast(true); clearSession(); const t = setTimeout(() => setToast(false), 5000); return () => clearTimeout(t); }
    return undefined;
  }, []);
  const readFolder = () => getFolderHandle()
    .then(async (handle) => setFolder(!handle ? { state: 'none' } : { state: (await ensureAccess(handle, false)) ? 'ok' : 'lost', handle }))
    .catch((error: unknown) => { console.error('Motikord: could not read the save folder', error); setFolder({ state: 'none' }); });
  useEffect(() => { void readFolder(); }, []);
  useEffect(() => {
    if (!settings || !recipe || kind) return;
    setKind(nextKind ?? settings.defaultExport.kind);
    nextKind = undefined;
    setQuality(settings.defaultExport.quality);
    setAspects([recipe.aspect]);
    setCredits(creditsBox(recipe).on);
  }, [settings, recipe, kind]);

  if (!recipe || !kind || !aspects || !quality || credits === undefined) {
    return <DialogShell width={560} label="Export" style={{ padding: '18px 20px' }}><span role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>Export</span></DialogShell>;
  }
  const { locked, on: withCredits } = creditsBox(recipe, credits);
  const choice: JobChoice = { kinds: [kind], aspects: ASPECTS.filter((a) => aspects.includes(a)), quality, credits: withCredits };
  const items = planExport(recipe, choice);
  const files = youllGet(recipe.name, choice.aspects, choice.kinds, withCredits);
  const folderName = settings?.folderName ?? 'Motikord clips';

  const pick = async () => { if (await chooseFolder().catch(() => undefined)) await readFolder(); };
  const allow = async () => { if (folder.state === 'lost' && (await ensureAccess(folder.handle, true).catch(() => false))) await readFolder(); };
  const start = async () => {
    if (!clipId || !items.length) return;
    setBusy(true);
    try {
      const root = await folderFromClick();
      if (!root) { await readFolder(); return; }
      beginExport(recipe, clipId, choice, root);
      navigate('Rendering', { clipId });
    } catch (error) {
      console.error('Motikord: could not start the export', error);
      await readFolder();
    } finally { setBusy(false); }
  };
  const toggleAspect = (a: Aspect) => setAspects(aspects.includes(a) ? aspects.filter((x) => x !== a) : [...aspects, a]);

  return (
    <DialogShell width={560} label="Export" style={{ padding: '18px 20px 20px', gap: 14, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Export</h1>
        <IconButton aria-label="Close" onClick={close}><CloseIcon /></IconButton>
      </div>
      {toast && <ExportCancelled />}

      <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend style={legend}>File type</legend>
        <div role="radiogroup" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {KINDS.map(([k, name, line]) => (
            <label key={k} style={radio(kind === k)}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} style={{ accentColor: 'var(--accent)', margin: '2px 0 0' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{line}</span></span>
            </label>
          ))}
        </div>
        <TypeNotes gif={kind === 'gif'} seeThrough={kind === 'webm-alpha'} />
      </fieldset>

      <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend style={legend}>Sizes</legend>
        {ASPECTS.map((a) => (
          <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <input type="checkbox" checked={aspects.includes(a)} onChange={() => toggleAspect(a)} style={box} />
            <span style={{ fontFamily: 'var(--mono)', width: 44 }}>{a}</span><span style={{ color: 'var(--muted)' }}>{SIZE_USE[a]}</span>
          </label>
        ))}
      </fieldset>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>Quality</span>
        <div role="radiogroup" aria-label="Quality" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: '#F1F1F3' }}>
          {(['720p', '1080p'] as const).map((q) => (
            <button key={q} type="button" role="radio" aria-checked={quality === q} onClick={() => setQuality(q)}
              style={{ height: 30, padding: '0 12px', border: 0, borderRadius: 6, font: `${quality === q ? 600 : 400} 12px/1 var(--font)`, color: quality === q ? 'var(--ink)' : 'var(--muted)', background: quality === q ? 'var(--surface)' : 'transparent', boxShadow: quality === q ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', cursor: 'pointer' }}>{q}</button>
          ))}
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>30 fps</span>
      </div>

      {folder.state === 'none' && <FolderNotPicked onChoose={() => void pick()} />}
      {folder.state === 'lost' && <FolderAccessLost folder={folderName} onAllow={() => void allow()} onChooseAnother={() => void pick()} />}
      {folder.state === 'ok' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'var(--ground)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          <span style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{folderName}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>Every export lands here</span></span>
          <Button variant="secondary" onClick={() => void pick()} style={{ height: 32, padding: '0 12px', fontSize: 12 }}>Change</Button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} onMouseEnter={() => locked && setLockNote(true)} onMouseLeave={() => setLockNote(false)}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }} onClick={() => locked && setLockNote(true)}>
          <input type="checkbox" checked={withCredits} disabled={locked} onChange={(e) => setCredits(e.target.checked)} onFocus={() => locked && setLockNote(true)} style={box} />
          <span>Credits file (credits.txt)</span>
          {locked && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Needed: this clip uses CC BY media</span>}
        </label>
        {locked && lockNote && <CreditLocked />}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 12px', borderRadius: 10, border: '1px solid #EFEFF1' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>You’ll get</span>
        {files.map((f) => <span key={f} style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{f}</span>)}
      </div>

      <div style={{ flexGrow: 1 }} />
      <Button block busy={busy} disabled={!items.length || folder.state === 'loading'} onClick={() => void start()} style={{ height: 48, borderRadius: 12, flexShrink: 0 }}>{exportButton(items.length)}</Button>
      <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)', marginTop: -6 }}>{estimateLine(items)}</span>
    </DialogShell>
  );
}
