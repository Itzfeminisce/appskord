/** Share and ShareEditFile, with the StatesShare export states: exporting, exported and export-too-big. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '@/lib/board/types';
import { boardFiles, formatBytes, prepareForShare, shareFileName, type ShareOptions } from '@/lib/share/prepare';
import { estimateEditBytes, estimateViewBytes, filesToLeaveOut, VIEW_FILE_LIMIT } from '@/lib/share/size';
import { loadSettings } from '@/lib/store/settings';
import { Close } from '../icons';
import { makeEditFile, makeViewFile, saveBlob, viewPageBytes, type ExportStep } from './exportFile';

export type ShareKind = 'view' | 'edit';

type Phase =
  | { at: 'form' }
  | { at: 'too-big'; bytes: number; leaveOut: string[] }
  | { at: 'exporting'; step: ExportStep }
  | { at: 'exported'; name: string; bytes: number };

const Lock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const Warn = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bk-warn-ink)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="bk-share-warn-icon">
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);

const Done = () => (
  <span className="bk-share-done" aria-hidden="true">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
  </span>
);

export function ShareDialog({ board, initialKind = 'view', onClose }: { board: Board; initialKind?: ShareKind; onClose(): void }) {
  const [kind, setKind] = useState<ShareKind>(initialKind);
  const [options, setOptions] = useState<ShareOptions>({ notes: false, pageText: true });
  const [person, setPerson] = useState('');
  const [pageBytes, setPageBytes] = useState<number>();
  const [phase, setPhase] = useState<Phase>({ at: 'form' });
  const abort = useRef<AbortController>(undefined);

  useEffect(() => {
    let live = true;
    loadSettings()
      .then((s) => {
        if (!live) return;
        setOptions({ notes: s.includeNotes, pageText: s.includePageText });
        setPerson(s.sharingName);
      })
      .catch((error) => console.error('Briefkord: could not load settings', error));
    viewPageBytes()
      .then((n) => live && setPageBytes(n))
      .catch((error) => console.error('Briefkord: could not load the view file renderer', error));
    return () => {
      live = false;
      abort.current?.abort();
    };
  }, []);

  const shared = useMemo(() => prepareForShare(board, options), [board, options]);
  const viewBytes = pageBytes === undefined ? undefined : estimateViewBytes(shared, pageBytes);
  const editBytes = estimateEditBytes(shared);
  const cards = Object.keys(board.cards).length;
  const files = boardFiles(board).length;
  const name = shareFileName(board.name, kind === 'view' ? 'html' : 'briefkord');

  const cancel = () => {
    abort.current?.abort();
    setPhase({ at: 'form' });
  };
  const close = () => {
    abort.current?.abort();
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (phase.at === 'exporting') cancel();
      else close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const run = async (leaveOut: string[] = []) => {
    const controller = new AbortController();
    abort.current = controller;
    setPhase({ at: 'exporting', step: { done: 0, total: files + 1 } });
    const progress = { signal: controller.signal, onProgress: (step: ExportStep) => !controller.signal.aborted && setPhase({ at: 'exporting', step }) };
    try {
      const blob = kind === 'view'
        ? await makeViewFile(board, options, new Set(leaveOut), progress)
        : await makeEditFile(board, options, person, progress);
      if (controller.signal.aborted) return;
      saveBlob(blob, name);
      setPhase({ at: 'exported', name, bytes: blob.size });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(`Briefkord: could not make the ${kind} file`, error);
      setPhase({ at: 'form' });
    }
  };

  const save = () => {
    if (kind === 'view' && pageBytes !== undefined && viewBytes !== undefined && viewBytes > VIEW_FILE_LIMIT) {
      setPhase({ at: 'too-big', bytes: viewBytes, leaveOut: filesToLeaveOut(shared, pageBytes) });
      return;
    }
    void run();
  };

  const option = (value: ShareKind, title: string, text: string, bytes: number | undefined) => (
    <label className={`bk-share-kind${kind === value ? ' is-on' : ''}`}>
      <input type="radio" name="bk-share-kind" checked={kind === value} onChange={() => setKind(value)} />
      <span className="bk-share-kind-text">
        <span className="bk-share-kind-head">
          <span className="bk-share-kind-title">{title}</span>
          <span className="bk-share-file">{shareFileName(board.name, value === 'view' ? 'html' : 'briefkord')}</span>
        </span>
        <span className="bk-share-kind-sub">{text}</span>
      </span>
      <span className="bk-share-size">{bytes === undefined ? '' : formatBytes(bytes)}</span>
    </label>
  );

  const toggle = (key: keyof ShareOptions, title: string, text: string) => (
    <label className="bk-share-toggle">
      <span className="bk-share-toggle-text">
        <span className="bk-share-toggle-title">{title}</span>
        <span className="bk-share-toggle-sub">{text}</span>
      </span>
      <input type="checkbox" role="switch" checked={options[key]} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />
    </label>
  );

  let body;
  if (phase.at === 'exporting') {
    const pct = Math.round((phase.step.done / Math.max(1, phase.step.total)) * 100);
    body = (
      <div className="bk-share-state" aria-busy="true">
        <span className="bk-share-state-title">{kind === 'view' ? 'Making the view file…' : 'Making the edit file…'}</span>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Export progress" className="bk-share-bar"><span style={{ width: `${pct}%` }} /></div>
        <span className="bk-share-state-sub">Packing {cards} {cards === 1 ? 'card' : 'cards'} and {files} {files === 1 ? 'image' : 'images'} · {pct}%</span>
        <button type="button" className="bk-btn-s bk-share-start" onClick={cancel}>Cancel</button>
      </div>
    );
  } else if (phase.at === 'exported') {
    body = (
      <div role="status" className="bk-share-state">
        <span className="bk-row"><Done /><span className="bk-share-state-title">Saved to Downloads</span></span>
        <span className="bk-share-mono">{phase.name} · {formatBytes(phase.bytes)}</span>
        <span className="bk-share-state-text">{kind === 'view' ? 'Send it by email, chat or a shared drive. It opens in any browser.' : 'Send it by email, chat or a shared drive.'}</span>
        <span className="bk-row bk-share-actions">
          <button type="button" className="bk-btn-m bk-btn-primary" autoFocus onClick={close}>Done</button>
        </span>
      </div>
    );
  } else if (phase.at === 'too-big') {
    const n = phase.leaveOut.length;
    body = (
      <div role="alert" className="bk-share-state is-warn">
        <span className="bk-share-state-title">This view file would be {formatBytes(phase.bytes)}</span>
        <span className="bk-share-state-text">Files that big are slow to open and hard to send. Leave out the {n} largest {n === 1 ? 'file' : 'files'}, which become links, or send the edit file instead.</span>
        <span className="bk-row bk-share-actions">
          <button type="button" className="bk-btn-m bk-btn-primary" autoFocus onClick={() => void run(phase.leaveOut)}>Leave out {n} {n === 1 ? 'file' : 'files'}</button>
          <button type="button" className="bk-btn-m bk-share-amber" onClick={() => void run()}>Save it anyway</button>
        </span>
      </div>
    );
  }

  return (
    <div className="bk-scrim" onPointerDown={(e) => e.target === e.currentTarget && phase.at !== 'exporting' && close()}>
      <section role="dialog" aria-modal="true" aria-labelledby="bk-share-title" className="bk-share">
        <header className="bk-share-head">
          <div className="bk-share-head-text">
            <h2 id="bk-share-title">Share “{board.name}”</h2>
            <p>Briefkord makes a file. You send it however you like.</p>
          </div>
          <button type="button" className="bk-icon-btn bk-icon-sm" aria-label="Close" onClick={close}><Close size={16} /></button>
        </header>
        {body ?? (
          <>
            <div role="radiogroup" aria-label="Kind of file" className="bk-share-kinds">
              {option('view', 'View file', 'Opens in any browser, no install. Teammates can look and walk through it, but not change it.', viewBytes)}
              {option('edit', 'Edit file', 'A teammate imports it into Briefkord, edits it and sends it back. It opens as a new board, so nothing is overwritten.', editBytes)}
            </div>
            <div className="bk-share-toggles">
              {toggle('notes', 'Include my notes', '“What to say about it” on each card. Off, they stay with you.')}
              {kind === 'edit' && options.notes && (
                <div role="note" className="bk-share-warn">
                  <Warn />
                  <span>Your notes on all {cards} {cards === 1 ? 'card' : 'cards'} go in the file. Anyone who opens it can read them, and their edits come back with theirs.</span>
                </div>
              )}
              {toggle('pageText', 'Include saved page text', 'Lets search and summaries work for them. Links and previews go either way.')}
            </div>
            <footer className="bk-share-foot">
              <Lock />
              <span className="bk-grow bk-share-foot-text">Never uploaded. Anyone with the file can open it.</span>
              <button type="button" className="bk-btn-m bk-share-btn" onClick={close}>Cancel</button>
              <button type="button" className="bk-btn-m bk-btn-primary bk-share-btn" onClick={save}>{kind === 'view' ? 'Save view file' : 'Save edit file'}</button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
