/** Import (#/import): reads an edit file, shows who it is from, and makes it a new board. StatesShare import-* states. */
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useRouter } from '@appskord/platform/router';
import type { Board } from '@/lib/board/types';
import { EDIT_FILE_EXT, unpackEditFile, type EditPackage, type UnpackError } from '@/lib/share/editFile';
import { findOwnBoard, importBoard, importName } from '@/lib/share/importBoard';
import { formatBytes, formatDay, formatTime } from '@/lib/share/prepare';
import { loadAllBoards, saveBoard } from '@/lib/store/db';
import { deleteBoardFiles, writeFile } from '@/lib/store/files';
import { UploadIcon } from '../icons';
import { takePendingImport } from './pending';

type State =
  | { at: 'pick' }
  | { at: 'reading'; file: File }
  | { at: 'error'; file: File; error: UnpackError }
  | { at: 'ready'; file: File; pkg: EditPackage; own?: Board; name: string }
  | { at: 'importing'; file: File; pkg: EditPackage; own?: Board; name: string };

const FileMark = () => (
  <span className="bk-import-mark" aria-hidden="true">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="7" height="9" rx="2" fill="var(--bk-card)" />
      <rect x="13" y="4" width="7" height="5" rx="2" fill="var(--bk-card)" />
      <rect x="13" y="11" width="7" height="9" rx="2" fill="var(--bk-logo-teal)" />
      <rect x="4" y="15" width="7" height="5" rx="2" fill="var(--bk-card)" />
    </svg>
  </span>
);

const Info = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="bk-import-info-icon">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export function ImportScreen() {
  const router = useRouter();
  const go = useCallback((path: string) => router.history.push(path), [router]);
  const [state, setState] = useState<State>({ at: 'pick' });
  const picker = useRef<HTMLInputElement>(null);

  const read = useCallback(async (file: File) => {
    setState({ at: 'reading', file });
    try {
      const result = unpackEditFile(new Uint8Array(await file.arrayBuffer()), file.name.toLowerCase().endsWith(EDIT_FILE_EXT));
      if (!result.ok) {
        if (result.problems) console.error('Briefkord: could not read the edit file', result.problems);
        setState({ at: 'error', file, error: result.error });
        return;
      }
      const own = findOwnBoard(await loadAllBoards(), result.pkg.board.id);
      setState({ at: 'ready', file, pkg: result.pkg, own, name: importName(result.pkg.board.name, result.pkg.from.person || 'a teammate') });
    } catch (error) {
      console.error('Briefkord: could not read the edit file', error);
      setState({ at: 'error', file, error: 'damaged' });
    }
  }, []);

  useEffect(() => {
    const file = takePendingImport();
    if (file) void read(file);
  }, [read]);

  const leave = useCallback(() => go('/boards'), [go]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && leave();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave]);

  const confirm = async () => {
    if (state.at !== 'ready') return;
    setState({ ...state, at: 'importing' });
    const { board, files } = importBoard(state.pkg, state.own, { name: state.name, nonce: crypto.randomUUID().slice(0, 8), now: Date.now() });
    try {
      for (const [id, bytes] of Object.entries(files)) await writeFile(board.id, id, new Blob([bytes as BlobPart]));
      await saveBoard(board);
      go(`/b/${board.id}`);
    } catch (error) {
      console.error('Briefkord: could not import the board', error);
      await deleteBoardFiles(board.id).catch(() => undefined);
      setState({ ...state, at: 'error', error: 'damaged' });
    }
  };

  const choose = () => picker.current?.click();
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void read(file);
  };

  let content;
  if (state.at === 'pick' || state.at === 'reading') {
    content = (
      <div className="bk-import-body">
        <button type="button" className="bk-import-drop" onClick={choose} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} disabled={state.at === 'reading'}>
          <UploadIcon size={22} />
          <span className="bk-import-drop-title">Import a .briefkord file</span>
          <span className="bk-import-drop-sub">Only .briefkord files made with “Edit file” in Share can be imported.</span>
        </button>
      </div>
    );
  } else if (state.at === 'error') {
    content = state.error === 'newer-version' ? (
      <div className="bk-import-body">
        <div role="alert" className="bk-share-state is-warn">
          <span className="bk-share-state-title">This file comes from a newer Briefkord</span>
          <span className="bk-share-state-text">Update Briefkord on the Chrome extensions page, then import it again. Your boards are untouched.</span>
        </div>
      </div>
    ) : (
      <div className="bk-import-body">
        <div role="alert" className="bk-share-state is-error">
          {state.error === 'damaged' ? (
            <span className="bk-share-state-title">Part of this file is damaged. Ask for a fresh copy.</span>
          ) : (
            <>
              <span className="bk-share-state-title">“{state.file.name}” isn’t a Briefkord file</span>
              <span className="bk-share-state-text">Only .briefkord files made with “Edit file” in Share can be imported. Nothing was added.</span>
            </>
          )}
          <button type="button" className="bk-btn-m bk-share-red bk-share-start" onClick={choose}>Choose another file</button>
        </div>
      </div>
    );
  } else {
    const { pkg, own, file } = state;
    const sender = pkg.from.person || 'a teammate';
    const fileCount = Object.keys(pkg.files).length;
    content = (
      <div className="bk-import-body">
        <div className="bk-row bk-import-who">
          <FileMark />
          <div className="bk-import-who-text">
            <h2 id="bk-import-title">Import a board from {sender}</h2>
            <span className="bk-share-file">{file.name} · {formatBytes(file.size)}</span>
          </div>
        </div>
        <div className="bk-import-stats">
          <div><span className="bk-import-n">{Object.keys(pkg.board.cards).length}</span><span>cards</span></div>
          <div><span className="bk-import-n">{fileCount}</span><span>images and files</span></div>
          <div><span className="bk-import-n">{pkg.from.at ? formatDay(pkg.from.at) : '–'}</span><span>{pkg.from.at ? `exported ${formatTime(pkg.from.at)}` : ''}</span></div>
        </div>
        <div className="bk-import-field">
          <label htmlFor="bk-import-name">Board name</label>
          <input id="bk-import-name" type="text" value={state.name} disabled={state.at === 'importing'} onChange={(e) => setState({ ...state, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void confirm()} />
        </div>
        <div className="bk-import-info">
          <Info />
          <span>{own ? `It opens as a new board. Your own “${own.name}” stays as it is, so you can put the two side by side.` : 'It opens as a new board.'}</span>
        </div>
      </div>
    );
  }

  const ready = state.at === 'ready' || state.at === 'importing';
  return (
    <div className="bk-import-page">
      <div className="bk-import-top" aria-hidden="true" />
      <div className="bk-scrim bk-import-scrim" onPointerDown={(e) => e.target === e.currentTarget && leave()}>
        <section role="dialog" aria-modal="true" aria-labelledby={ready ? 'bk-import-title' : undefined} aria-label={ready ? undefined : 'Import a .briefkord file'} className="bk-share bk-import">
          {content}
          <footer className="bk-share-foot bk-import-foot">
            <button type="button" className="bk-btn-m bk-share-btn" onClick={leave}>Cancel</button>
            {ready && (
              <button type="button" className="bk-btn-m bk-btn-primary bk-share-btn" disabled={state.at === 'importing'} onClick={() => void confirm()}>Import as a new board</button>
            )}
          </footer>
        </section>
      </div>
      <input
        ref={picker}
        type="file"
        accept=".briefkord"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void read(file);
        }}
      />
    </div>
  );
}
