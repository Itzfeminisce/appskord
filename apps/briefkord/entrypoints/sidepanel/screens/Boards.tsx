/** Frames PanelBoards and PanelRename, StatesBoard `delete-board` and StatesMore `panel-find-no-match`. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BoardMeta } from '@/lib/board/types';
import { onDay, ago } from '@/lib/capture/text';
import { loadBoard } from '@/lib/store/db';
import { chooseBoard, DELETE_UNDO_MS, deleteBoardLater, makeBoard, openBoardTab, openImport, pinBoard, renameBoardNamed, usePanel } from '../data';
import { ImportIcon, MoreIcon, PlusIcon, SearchIcon } from '../icons';
import { BackHeader, plural, useDismiss, useGo, useToast, type ToastState } from '../ui';

function meta(board: BoardMeta, now: number): string {
  const cards = plural(board.cards, 'card');
  if (board.imported) return `${cards} · from ${board.imported.person} · imported ${onDay(board.imported.at, now)}`;
  return `${cards} · edited ${ago(board.updatedAt, now)}`;
}

function RowMenu({ board, onClose, onRename, onPin, onDelete }: { board: BoardMeta; onClose: () => void; onRename: () => void; onPin: () => void; onDelete: () => void }) {
  const ref = useDismiss(true, onClose);
  const first = useRef<HTMLButtonElement>(null);
  const [up, setUp] = useState(false);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    let box: HTMLElement | null = menu.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
    // Open upward when the list ends before the menu does, so no item hides under the footer.
    if (menu.getBoundingClientRect().bottom > bottom) setUp(true);
  }, [ref]);
  useEffect(() => first.current?.focus(), []);
  const item = (label: string, run: () => void, danger = false, focus = false) => (
    <button
      ref={focus ? first : undefined}
      type="button"
      role="menuitem"
      className={`p-menu-item${danger ? ' is-danger' : ''}`}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {label}
    </button>
  );
  return (
    <div ref={ref} role="menu" aria-label={board.name} className={`p-menu p-board-menu${up ? ' is-up' : ''}`}>
      {item('Open in a tab', () => openBoardTab(board.id), false, true)}
      {item('Rename', onRename)}
      {item(board.pinned ? 'Unpin' : 'Pin', onPin)}
      {item('Share as a file…', () => openBoardTab(board.id, { share: '1' }))}
      <span aria-hidden="true" className="p-menu-line" />
      {item('Delete board…', onDelete, true)}
    </div>
  );
}

function RenameRow({ board, onDone }: { board: BoardMeta; onDone: () => void }) {
  const [name, setName] = useState(board.name);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && name.trim() && name.trim() !== board.name) void renameBoardNamed(board.id, name);
    onDone();
  };
  return (
    <li className="p-board is-renaming">
      <label htmlFor="pr-name" className="sr-only">
        Board name
      </label>
      <input
        id="pr-name"
        className="p-input"
        type="text"
        value={name}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') {
            e.stopPropagation();
            finish(false);
          }
        }}
        onBlur={() => finish(true)}
      />
      <span className="p-hint">Enter to save · Esc to cancel</span>
    </li>
  );
}

interface Deleting { board: BoardMeta; images: number }

export function Boards() {
  const { boards, board: current, hide } = usePanel();
  const go = useGo();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<string>();
  const [renaming, setRenaming] = useState<string>();
  const [deleting, setDeleting] = useState<Deleting>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const now = Date.now();

  const q = query.trim().toLowerCase();
  const shown = q ? boards.filter((b) => b.name.toLowerCase().includes(q)) : boards;
  const pinned = shown.filter((b) => b.pinned);
  const recent = shown.filter((b) => !b.pinned).sort((a, b) => b.updatedAt - a.updatedAt);

  const pin = (board: BoardMeta) => {
    const next = !board.pinned;
    void pinBoard(board.id, next);
    if (next) toast.show({ text: `“${board.name}” pinned. It moves to the top.`, undo: () => void pinBoard(board.id, false), ms: 6000 });
  };
  const askDelete = async (board: BoardMeta) => {
    const full = await loadBoard(board.id);
    const images = full ? Object.values(full.cards).filter((c) => c.kind === 'image').length : 0;
    setDeleting({ board, images });
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const { board } = deleting;
    setDeleting(undefined);
    hide(board.id, true);
    const undo = await deleteBoardLater(board.id);
    const message: ToastState = {
      text: `“${board.name}” deleted.`,
      undo: () => void undo().then(() => hide(board.id, false)),
      ms: DELETE_UNDO_MS,
    };
    toast.show(message);
  };
  const makeNamed = async (name: string) => {
    await makeBoard(name);
    go('/');
  };

  const row = (board: BoardMeta) => {
    if (renaming === board.id) return <RenameRow key={board.id} board={board} onDone={() => setRenaming(undefined)} />;
    const isCurrent = board.id === current?.id;
    return (
      <li key={board.id} className={`p-board${isCurrent ? ' is-current' : ''}`}>
        <button
          type="button"
          className="p-board-open"
          onClick={() => {
            void chooseBoard(board.id).then(() => go('/'));
          }}
        >
          <span className="p-board-name">{board.name}</span>
          <span className="p-board-meta">{meta(board, now)}</span>
        </button>
        {isCurrent && (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--bk-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-label="Saving here" role="img">
            <path d="m5 12 5 5 9-10" />
          </svg>
        )}
        <button type="button" className="p-more" aria-label={`More for ${board.name}`} aria-expanded={menu === board.id} onClick={() => setMenu(menu === board.id ? undefined : board.id)}>
          <MoreIcon />
        </button>
        {menu === board.id && <RowMenu board={board} onClose={closeMenu} onRename={() => setRenaming(board.id)} onPin={() => pin(board)} onDelete={() => void askDelete(board)} />}
      </li>
    );
  };

  return (
    <div className="panel">
      <BackHeader title="Boards">
        <button type="button" className="p-btn is-primary is-new" onClick={() => go('/new')}>
          <PlusIcon size={14} strokeWidth={2.4} />
          New board
        </button>
      </BackHeader>
      <div className="panel-scroll">
        <div className="p-find">
          <label htmlFor="find-board" className="sr-only">
            Find a board
          </label>
          <SearchIcon size={16} stroke="var(--bk-text-2)" />
          <input id="find-board" className="p-input" type="search" placeholder="Find a board" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {q && !shown.length && (
          <div className="p-nomatch">
            <span>No board called “{query.trim()}”.</span>
            <button type="button" className="p-make-named" onClick={() => void makeNamed(query.trim())}>
              + Make a board called “{query.trim()}”
            </button>
          </div>
        )}
        {pinned.length > 0 && (
          <>
            <div className="p-group-head">Pinned</div>
            <ul className="p-list">{pinned.map(row)}</ul>
          </>
        )}
        {recent.length > 0 && (
          <>
            <div className="p-group-head" style={pinned.length ? { marginTop: 18 } : undefined}>
              Recent
            </div>
            <ul className="p-list">{recent.map(row)}</ul>
          </>
        )}
      </div>
      {toast.view}
      <div className="p-footer">
        <button type="button" className="p-btn is-small" onClick={openImport}>
          <ImportIcon />
          Import a .briefkord file
        </button>
        <p>Boards stay on this computer. Nothing is shared unless you export it.</p>
      </div>
      {deleting && (
        <div className="p-scrim" onClick={(e) => e.target === e.currentTarget && setDeleting(undefined)}>
          <div role="alertdialog" aria-labelledby="del-t" className="p-dialog" onKeyDown={(e) => e.key === 'Escape' && setDeleting(undefined)}>
            <span id="del-t" className="p-dialog-title">
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
    </div>
  );
}
