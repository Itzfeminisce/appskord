/** Frame SettingsStorage: total and bar, space per board with "Delete…", largest files with "Remove". */
import { useCallback, useEffect, useState } from 'react';
import { formatBytes } from '@/lib/capture/text';
import { storageState } from '@/lib/capture/save';
import { onBoardChanged } from '@/lib/store/channel';
import { loadAllBoards } from '@/lib/store/db';
import { deleteFile } from '@/lib/store/files';
import { DELETE_UNDO_MS, deleteBoardLater, editBoard, usePanel } from '../data';
import { plural, useToast } from '../ui';
import { boardWithoutFile, share, storageTotals, type BigFile, type BoardSpace, type StorageTotals, type StoredFile } from './model';

/** Every card file in OPFS with its size on disk. */
async function listStoredFiles(): Promise<StoredFile[]> {
  type Dir = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
  let boards: Dir;
  try {
    boards = (await (await navigator.storage.getDirectory()).getDirectoryHandle('boards')) as Dir;
  } catch {
    return [];
  }
  const out: StoredFile[] = [];
  for await (const dir of boards.values()) {
    if (dir.kind !== 'directory') continue;
    for await (const file of (dir as Dir).values()) {
      if (file.kind === 'file') out.push({ boardId: dir.name, fileId: file.name, size: (await (file as FileSystemFileHandle).getFile()).size });
    }
  }
  return out;
}

export function Storage() {
  const { hidden, hide } = usePanel();
  const toast = useToast();
  const [totals, setTotals] = useState<StorageTotals>();
  const [whole, setWhole] = useState(0);
  const [deleting, setDeleting] = useState<{ board: BoardSpace; images: number }>();

  const load = useCallback(async () => {
    const [boards, files, space] = await Promise.all([loadAllBoards(), listStoredFiles(), storageState()]);
    const live = boards.filter((b) => !hidden.has(b.id));
    const ids = new Set(live.map((b) => b.id));
    const next = storageTotals(live, files.filter((f) => ids.has(f.boardId)));
    setTotals(next);
    // The bar is Briefkord's share of the space this browser allows it.
    setWhole(Number.isFinite(space.free) ? space.used + space.free : next.total);

  }, [hidden]);

  useEffect(() => {
    const run = () => void load().catch((error: unknown) => console.error('Briefkord: could not measure the storage', error));
    run();
    return onBoardChanged(run);
  }, [load]);

  const askDelete = async (board: BoardSpace) => {
    const full = (await loadAllBoards()).find((b) => b.id === board.id);
    const images = full ? Object.values(full.cards).filter((c) => c.kind === 'image').length : 0;
    setDeleting({ board, images });
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const { board } = deleting;
    setDeleting(undefined);
    hide(board.id, true);
    const undo = await deleteBoardLater(board.id);
    toast.show({ text: `“${board.name}” deleted.`, undo: () => void undo().then(() => hide(board.id, false)), ms: DELETE_UNDO_MS });
  };
  const remove = async (file: BigFile) => {
    try {
      // The card keeps its name; only the bytes go.
      await editBoard(file.boardId, (b) => boardWithoutFile(b, file.fileId, Date.now()));
      await deleteFile(file.boardId, file.fileId);
    } catch (error) {
      console.error('Briefkord: could not remove the file', error);
    }
    await load();
  };

  if (!totals) return <main className="st-main" />;
  const segments: [string, number][] = [
    ['Images and files', totals.files],
    ['Saved page text', totals.pageText],
    ['Boards', totals.boards],
  ];

  return (
    <main className="st-main">
      <div className="st-cols is-storage">
        <div className="st-col">
          <h2 className="st-h2">Storage</h2>
          <section className="st-card">
            <div className="st-total">
              <span className="mono">{formatBytes(totals.total)}</span>
              <span>used by Briefkord on this computer</span>
            </div>
            <div role="img" aria-label={segments.map(([label, bytes]) => `${label} ${formatBytes(bytes)}`).join(', ')} className="st-bar">
              {segments.map(([label, bytes]) => (
                <span key={label} style={{ width: `${share(bytes, whole)}%` }} />
              ))}
            </div>
            <div className="st-legend">
              {segments.map(([label, bytes], i) => (
                <span key={label}>
                  <span className={`st-dot ${['is-files', 'is-text', 'is-boards'][i]}`} />
                  {label} {formatBytes(bytes)}
                </span>
              ))}
            </div>
          </section>
          <table className="st-table">
            <thead>
              <tr>
                <th scope="col">Board</th>
                <th scope="col" className="is-num">Cards</th>
                <th scope="col" className="is-num">Space</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.perBoard.map((board) => (
                <tr key={board.id}>
                  <td className="is-name">{board.name}</td>
                  <td className="is-num">{board.cards}</td>
                  <td className="is-num">{formatBytes(board.bytes)}</td>
                  <td className="is-act">
                    <button type="button" className="st-delete" onClick={() => void askDelete(board)}>
                      Delete…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="st-aside">
          <section className="st-card" style={{ gap: 8 }}>
            <h3 className="st-h4">Largest files</h3>
            {totals.largest.map((file) => (
              <div key={`${file.boardId}/${file.fileId}`} className="st-file">
                <span className="st-lines">
                  <strong>{file.name}</strong>
                  <span>
                    {file.boardName} · {formatBytes(file.size)}
                  </span>
                </span>
                <button type="button" className="st-btn is-tiny" onClick={() => void remove(file)}>
                  Remove
                </button>
              </div>
            ))}
            <span className="st-muted">Removing a file keeps its card with the name, so the board still makes sense.</span>
          </section>
          <span className="st-muted">Everything here is on this computer only. Export a board first if you want to keep a copy before deleting.</span>
        </aside>
      </div>
      {toast.view}
      {deleting && (
        <div className="p-scrim" onClick={(e) => e.target === e.currentTarget && setDeleting(undefined)}>
          <div role="alertdialog" aria-labelledby="st-del-t" className="p-dialog" style={{ maxWidth: 400 }} onKeyDown={(e) => e.key === 'Escape' && setDeleting(undefined)}>
            <span id="st-del-t" className="p-dialog-title">
              Delete “{deleting.board.name}”?
            </span>
            <span className="p-dialog-text">
              {deleting.images
                ? `Its ${plural(deleting.board.cards, 'card')} and ${plural(deleting.images, 'image')} are removed from this computer.`
                : `Its ${plural(deleting.board.cards, 'card')} ${deleting.board.cards === 1 ? 'is' : 'are'} removed from this computer.`}{' '}
              Files you exported before are not touched.
            </span>
            <div className="p-dialog-actions">
              <button type="button" autoFocus onClick={() => setDeleting(undefined)}>
                Keep it
              </button>
              <button type="button" className="is-danger" onClick={() => void confirmDelete()}>
                Delete board
              </button>
            </div>
            <span className="p-dialog-hint">After deleting, “Undo” shows for 10 seconds.</span>
          </div>
        </div>
      )}
    </main>
  );
}
