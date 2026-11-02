import { useEffect, useRef, useState } from 'react';
import { buildExport, exportInfo, exportName, importMove, parseMove, previewMove, type ExportInfo, type MoveFile, type MovePreview } from '@/lib/move';
import { BackIcon } from '../../components/v4/icons';
import { useRouter } from '../../router';
import { megabytes } from './SettingsMemory';
import './settings.css';
import { refreshBadge } from '@/lib/messages';

/** Dev frames: a file from the other computer already chosen. */
export const moveDev: { chosen?: { name: string; preview: MovePreview } } = {};

const FileIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#44464D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></svg>
);

export default function Move() {
  const { back, canGoBack, replace } = useRouter();
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [chosen, setChosen] = useState<{ name: string; preview: MovePreview; file?: MoveFile } | null>(moveDev.chosen ?? null);
  const [busy, setBusy] = useState<'' | 'save' | 'import'>('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    exportInfo().then(setInfo).catch((error) => console.error('Rekord: could not measure your meetings', error));
  }, []);

  async function save() {
    setBusy('save');
    try {
      const url = URL.createObjectURL(await buildExport());
      const a = document.createElement('a');
      a.href = url;
      a.download = exportName(Date.now());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      console.error('Rekord: could not save the file', error);
    } finally {
      setBusy('');
    }
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    const parsed = await parseMove(file);
    if (!parsed) {
      console.error('Rekord: could not read the file', file.name);
      setChosen(null);
      return;
    }
    setChosen({ name: file.name, preview: await previewMove(parsed), file: parsed });
  }

  async function bringIn() {
    if (!chosen?.file) return input.current?.click();
    setBusy('import');
    try {
      await importMove(chosen.file);
      refreshBadge();
      replace('home');
    } catch (error) {
      console.error('Rekord: could not bring Rekord in', error);
    } finally {
      setBusy('');
    }
  }

  const p = chosen?.preview;
  return (
    <main className="sm-screen">
      <header className="sm-head">
        <button type="button" className="v4-icon" aria-label="Back" onClick={() => (canGoBack ? back() : replace('settingsMemory'))}><BackIcon /></button>
        <h1>Move to a new computer</h1>
      </header>
      <div className="mv-body">
        <section className="mv-card">
          <h2>Take it with you</h2>
          <span className="mv-what">Save all of Rekord as one file</span>
          {info && (
            <div className="mv-size">
              <span className="mv-size-mb">{megabytes(info.bytes)}</span>
              <span className="mv-size-what">{info.meetings} meetings, {info.people} people, {info.items} items{info.audio ? ', with audio' : ''}</span>
            </div>
          )}
          <p role="note" className="mv-warn">Anyone with this file can read your meetings. Keep it somewhere safe.</p>
          <button type="button" className="sm-btn" disabled={busy !== ''} onClick={() => void save()}>Save the file</button>
        </section>
        <section className="mv-card">
          <h2>Bring it back</h2>
          <span className="mv-what">Bring Rekord from another computer</span>
          <input ref={input} type="file" accept=".rekord,application/json" className="mv-hidden" aria-label="Bring Rekord from another computer" onChange={(e) => void pick(e.target.files?.[0])} />
          {chosen && (
            <button type="button" className="mv-file" onClick={() => input.current?.click()}>
              <FileIcon /><span>{chosen.name}</span>
            </button>
          )}
          {p && (
            <div className="mv-in">
              <span className="mv-in-label">In this file</span>
              <span className="mv-in-count"><span className="mv-mono">{p.meetings}</span> meetings, <span className="mv-mono">{p.people}</span> people, <span className="mv-mono">{p.already}</span> already here (kept once)</span>
            </div>
          )}
          <button type="button" className="sm-btn" disabled={busy !== ''} onClick={() => void bringIn()}>Bring it in</button>
        </section>
      </div>
    </main>
  );
}
