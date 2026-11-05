/** AllBoards (board tab "Boards ›"): find, import, pinned with previews, a new board tile, then every board newest first. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useRouter } from '@appskord/platform/router';
import { emptyBoard, newId, renameBoard, setPinned } from '@/lib/board/ops';
import type { Board } from '@/lib/board/types';
import { onBoardChanged } from '@/lib/store/channel';
import { deleteBoard, loadAllBoards, saveBoard, updateBoard } from '@/lib/store/db';
import { Logo, SearchIcon, Settings } from '../icons';
import { cardsCount, lastEdit } from '../logic/cards';
import { boardExtensions } from '../shell/extensions';
import { DeleteBoardDialog, Toast, type ToastState } from './States';

/** The section a new board starts with. */
export const FIRST_SECTION = 'Agenda';

const metaLine = (b: Board, now: number): string =>
  [cardsCount(Object.keys(b.cards).length), b.imported ? `from ${b.imported.person}` : '', lastEdit(b.updatedAt, now)].filter(Boolean).join(' · ');

export function AllBoards() {
  const router = useRouter();
  const go = useCallback((path: string) => router.history.push(path), [router]);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [find, setFind] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [deleting, setDeleting] = useState<Board>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<ToastState>();
  const pendingDelete = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const load = useCallback(() => {
    loadAllBoards()
      .then(setBoards)
      .catch((error: unknown) => {
        console.error('Briefkord: could not load the boards', error);
        setBoards([]);
      });
  }, []);
  useEffect(() => {
    load();
    return onBoardChanged(() => load());
  }, [load]);

  // A delete waits out its 10 s undo; leaving the page finishes it.
  useEffect(() => {
    const pending = pendingDelete.current;
    const flush = () => pending.forEach((timer, id) => (clearTimeout(timer), void deleteBoard(id)));
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  const now = Date.now();
  const visible = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (boards ?? []).filter((b) => !hidden.has(b.id) && (!q || b.name.toLowerCase().includes(q))).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [boards, find, hidden]);
  const pinned = visible.filter((b) => b.pinned);
  const rest = visible.filter((b) => !b.pinned);

  const edit = async (id: string, fn: (b: Board, now: number) => Board) => {
    try {
      await updateBoard(id, (b) => b && fn(b, Date.now()));
    } catch (error) {
      console.error('Briefkord: could not change the board', error);
    }
  };

  const remove = (board: Board) => {
    setDeleting(undefined);
    setHidden((h) => new Set(h).add(board.id));
    const timer = setTimeout(() => {
      pendingDelete.current.delete(board.id);
      deleteBoard(board.id).catch((error: unknown) => console.error('Briefkord: could not delete the board', error));
    }, 10_000);
    pendingDelete.current.set(board.id, timer);
    setToast({
      kind: 'undo',
      text: `“${board.name}” deleted.`,
      onUndo: () => {
        clearTimeout(pendingDelete.current.get(board.id));
        pendingDelete.current.delete(board.id);
        setHidden((h) => {
          const next = new Set(h);
          next.delete(board.id);
          return next;
        });
      },
    });
  };

  const onContext = (e: MouseEvent, id: string) => {
    e.preventDefault();
    setMenu({ id, x: e.clientX, y: e.clientY });
  };
  const menuBoard = menu ? boards?.find((b) => b.id === menu.id) : undefined;

  return (
    <div className="bk-boards">
      <header className="bk-topbar">
        <Logo />
        <h1 className="bk-boards-title">Boards</h1>
        <div className="bk-find">
          <label htmlFor="ab-find" className="bk-sr">Find a board</label>
          <span className="bk-find-icon"><SearchIcon size={16} /></span>
          <input id="ab-find" type="search" placeholder="Find a board" value={find} onChange={(e) => setFind(e.target.value)} />
        </div>
        <a className="bk-btn" href="#/import" onClick={(e) => (e.preventDefault(), go('/import'))}>Import</a>
        <button type="button" className="bk-icon-btn" aria-label="Settings" title="Settings" onClick={() => boardExtensions.openSettings()}><Settings /></button>
      </header>
      <main className="bk-boards-main">
        {pinned.length > 0 && <h2 className="bk-boards-h">Pinned</h2>}
        <div className="bk-boards-grid">
          {pinned.map((b) =>
            renaming === b.id ? (
              <RenameTile key={b.id} board={b} onDone={(name) => (setRenaming(undefined), name && void edit(b.id, (x, t) => renameBoard(x, name, t)))} />
            ) : (
              <a key={b.id} className="bk-board-tile is-pinned" href={`#/b/${b.id}`} onClick={(e) => (e.preventDefault(), go(`/b/${b.id}`))} onContextMenu={(e) => onContext(e, b.id)}>
                <Thumb board={b} />
                <span className="bk-tile-text"><span className="bk-tile-name">{b.name}</span><span className="bk-tile-meta">{metaLine(b, now)}</span></span>
              </a>
            ),
          )}
          <NewBoard onMake={async (name) => {
            const board = emptyBoard({ board: newId(), section: newId() }, name, FIRST_SECTION, Date.now());
            try {
              await saveBoard(board);
              go(`/b/${board.id}`);
            } catch (error) {
              console.error('Briefkord: could not make the board', error);
            }
          }} />
        </div>
        {rest.length > 0 && <h2 className="bk-boards-h bk-boards-h-2">All boards · newest first</h2>}
        <div className="bk-boards-grid">
          {rest.map((b) =>
            renaming === b.id ? (
              <RenameTile key={b.id} board={b} plain onDone={(name) => (setRenaming(undefined), name && void edit(b.id, (x, t) => renameBoard(x, name, t)))} />
            ) : (
              <a key={b.id} className="bk-board-tile" href={`#/b/${b.id}`} onClick={(e) => (e.preventDefault(), go(`/b/${b.id}`))} onContextMenu={(e) => onContext(e, b.id)}>
                <span className="bk-tile-name">{b.name}</span>
                <span className="bk-tile-meta">{metaLine(b, now)}</span>
              </a>
            ),
          )}
        </div>
        <p className="bk-boards-foot">Right-click a board for Open, Rename, Pin, Share as a file and Delete. Boards stay on this computer.</p>
      </main>
      {menu && menuBoard && (
        <BoardMenu
          x={menu.x}
          y={menu.y}
          pinned={menuBoard.pinned}
          onClose={() => setMenu(undefined)}
          onOpen={() => go(`/b/${menuBoard.id}`)}
          onRename={() => setRenaming(menuBoard.id)}
          onPin={() => void edit(menuBoard.id, (x, t) => setPinned(x, !x.pinned, t))}
          onShare={() => boardExtensions.shareBoard(menuBoard.id)}
          onDelete={() => setDeleting(menuBoard)}
        />
      )}
      {deleting && (
        <DeleteBoardDialog
          name={deleting.name}
          cards={Object.keys(deleting.cards).length}
          images={Object.values(deleting.cards).filter((c) => c.kind === 'image').length}
          onKeep={() => setDeleting(undefined)}
          onDelete={() => remove(deleting)}
        />
      )}
      {toast && <Toast toast={toast} onClose={() => setToast(undefined)} />}
    </div>
  );
}

/** A small picture of the board: its cards as blocks on the dot grid. */
function Thumb({ board }: { board: Board }) {
  const cards = Object.values(board.cards);
  const rects = cards.map((c) => c.rect);
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  const w = Math.max(...rects.map((r) => r.x + r.w)) - x, h = Math.max(...rects.map((r) => r.y + r.h)) - y;
  const scale = cards.length ? Math.min(200 / w, 90 / h, 0.3) : 1;
  return (
    <span aria-hidden="true" className="bk-thumb">
      {cards.slice(0, 40).map((c) => (
        <span key={c.id} className={`bk-thumb-card bk-thumb-${c.kind} bk-c-${c.colour}`} style={{ left: 14 + (c.rect.x - x) * scale, top: 16 + (c.rect.y - y) * scale, width: c.rect.w * scale, height: c.rect.h * scale }} />
      ))}
    </span>
  );
}

function RenameTile({ board, plain, onDone }: { board: Board; plain?: boolean; onDone(name?: string): void }) {
  const [name, setName] = useState(board.name);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && name.trim()) onDone(name.trim() === board.name ? undefined : name.trim());
    if (e.key === 'Escape') onDone();
  };
  return (
    <div className={plain ? 'bk-board-tile is-renaming' : 'bk-board-tile is-pinned is-renaming'}>
      {!plain && <Thumb board={board} />}
      <span className="bk-tile-rename">
        <label htmlFor={`rename-${board.id}`} className="bk-sr">Board name</label>
        <input id={`rename-${board.id}`} type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} onBlur={() => onDone()} />
        <span className="bk-tile-meta">Enter to save · Esc to cancel</span>
      </span>
    </div>
  );
}

function NewBoard({ onMake }: { onMake(name: string): void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState(false);
  const make = () => {
    if (!name.trim()) return setError(true);
    onMake(name.trim());
  };
  return (
    <div role="group" aria-label="New board" className="bk-new-board">
      <label htmlFor="nb">New board</label>
      <input id="nb" type="text" placeholder="Name it after the meeting" className={error ? 'is-error' : undefined} aria-invalid={error} value={name} onChange={(e) => (setName(e.target.value), setError(false))} onKeyDown={(e) => e.key === 'Enter' && make()} />
      {error && <span className="bk-field-error">Give the board a name.</span>}
      <button type="button" className="bk-btn-m bk-btn-primary" onClick={make}>Make the board</button>
    </div>
  );
}

function BoardMenu(props: { x: number; y: number; pinned: boolean; onClose(): void; onOpen(): void; onRename(): void; onPin(): void; onShare(): void; onDelete(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);
  const run = (fn: () => void) => () => (fn(), onClose());
  return (
    <div ref={ref} role="menu" aria-label="Board" className="bk-menu" style={{ left: Math.min(props.x, innerWidth - 240), top: Math.min(props.y, innerHeight - 240) }}>
      <button type="button" role="menuitem" onClick={run(props.onOpen)}>Open</button>
      <button type="button" role="menuitem" onClick={run(props.onRename)}>Rename</button>
      <button type="button" role="menuitem" onClick={run(props.onPin)}>{props.pinned ? 'Unpin' : 'Pin'}</button>
      <button type="button" role="menuitem" onClick={run(props.onShare)}>Share as a file</button>
      <span className="bk-menu-sep" aria-hidden="true" />
      <button type="button" role="menuitem" className="is-danger" onClick={run(props.onDelete)}>Delete</button>
    </div>
  );
}
