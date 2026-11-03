/** The panel's shared state: boards, the board it saves to, settings, the active tab and requests from the background. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { emptyBoard, newId, renameBoard, setPinned } from '@/lib/board/ops';
import type { Board, BoardMeta } from '@/lib/board/types';
import { takeIntents, type Notice, type PanelIntent, type PendingCapture } from '@/lib/capture/intent';
import { addMissingPreviews, storageState, type StorageState } from '@/lib/capture/save';
import { onGrant } from '@/lib/capture/shortcut';
import { onBoardChanged, postBoardChanged } from '@/lib/store/channel';
import { boardsDB, listBoards, loadBoard, saveBoard, updateBoard } from '@/lib/store/db';
import { deleteBoardFiles } from '@/lib/store/files';
import { loadSettings, saveSettings, type Settings } from '@/lib/store/settings';

/** Title of the one section a new board starts with. */
export const FIRST_SECTION = 'Agenda';
export const DELETE_UNDO_MS = 10_000;

export interface ActiveTab { id: number; windowId: number; url?: string; title?: string; status?: string }

interface PanelData {
  loaded: boolean;
  boards: BoardMeta[];
  board?: Board;
  settings?: Settings;
  tab?: ActiveTab;
  storage?: StorageState;
  notice?: Notice;
  setNotice: (notice?: Notice) => void;
  /** A right-clicked item waiting for "New board…". */
  capture?: PendingCapture;
  takeCapture: () => PendingCapture | undefined;
  hidden: Set<string>;
  hide: (id: string, hidden: boolean) => void;
}

const Context = createContext<PanelData | null>(null);

export function usePanel(): PanelData {
  const value = useContext(Context);
  if (!value) throw new Error('usePanel outside PanelProvider');
  return value;
}

/** Tells the background to rebuild the right-click menu (it may be asleep and miss the channel). */
const pingBackground = () => browser.runtime.sendMessage({ type: 'boards-changed' }).catch(() => undefined);

export async function makeBoard(name: string): Promise<Board> {
  const ids = { board: newId(), section: newId() };
  const board = emptyBoard(ids, name.trim(), FIRST_SECTION, Date.now());
  await saveBoard(board);
  await saveSettings({ lastBoardId: ids.board, lastSectionId: ids.section });
  void pingBackground();
  return board;
}

/** Changes the stored board and saves it in one step, so an edit made in a board tab meanwhile is kept. */
export async function editBoard(id: string, change: (board: Board) => Board): Promise<Board | undefined> {
  return (await updateBoard(id, (board) => (board ? change(board) : undefined))) ?? loadBoard(id);
}

export async function renameBoardNamed(id: string, name: string): Promise<void> {
  if (!name.trim()) return;
  await editBoard(id, (b) => renameBoard(b, name.trim(), Date.now()));
  void pingBackground();
}

export async function pinBoard(id: string, pinned: boolean): Promise<void> {
  await editBoard(id, (b) => setPinned(b, pinned, Date.now()));
}

export async function chooseBoard(id: string): Promise<void> {
  await saveSettings({ lastBoardId: id, lastSectionId: undefined });
}

/** Removes the board's records now and its files after the Undo window; returns the undo. */
export async function deleteBoardLater(id: string): Promise<() => Promise<void>> {
  const board = await loadBoard(id);
  if (!board) return async () => undefined;
  const tx = (await boardsDB.get()).transaction(['boards', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('boards').delete(id), tx.objectStore('meta').delete(id), tx.done]);
  postBoardChanged(id);
  void pingBackground();
  const timer = setTimeout(() => void deleteBoardFiles(id).catch((error: unknown) => console.error('Briefkord: could not delete the board files', error)), DELETE_UNDO_MS);
  return async () => {
    clearTimeout(timer);
    await saveBoard(board);
    void pingBackground();
  };
}

// Folders whose board is gone: left when the panel closed inside a delete's Undo window.
async function sweepOrphanFiles(): Promise<void> {
  const ids = new Set((await listBoards()).map((b) => b.id));
  let boards: FileSystemDirectoryHandle;
  try {
    boards = await (await navigator.storage.getDirectory()).getDirectoryHandle('boards');
  } catch {
    return;
  }
  const names: string[] = [];
  for await (const name of (boards as unknown as { keys(): AsyncIterable<string> }).keys()) if (!ids.has(name)) names.push(name);
  for (const name of names) {
    const dir = await boards.getDirectoryHandle(name);
    let fresh = false;
    for await (const file of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (file.kind === 'file' && Date.now() - (await (file as FileSystemFileHandle).getFile()).lastModified < 5 * 60_000) fresh = true;
    }
    // A folder written in the last minutes may belong to a board being saved right now.
    if (!fresh) await deleteBoardFiles(name);
  }
}

function useActiveTab(): ActiveTab | undefined {
  const [tab, setTab] = useState<ActiveTab>();
  useEffect(() => {
    let windowId: number | undefined;
    let alive = true;
    const read = async () => {
      windowId ??= (await browser.windows.getCurrent()).id;
      const [active] = await browser.tabs.query({ active: true, windowId });
      if (!alive || !active?.id) return;
      setTab({ id: active.id, windowId: active.windowId, url: active.url, title: active.title, status: active.status });
    };
    const refresh = () => void read().catch((error: unknown) => console.error('Briefkord: could not read the active tab', error));
    const onActivated = (info: { windowId: number }) => info.windowId === windowId && refresh();
    const onUpdated = (_id: number, change: { status?: string; title?: string; url?: string }, t: { active?: boolean; windowId?: number }) => {
      if (t.active && t.windowId === windowId && (change.status || change.title || change.url)) refresh();
    };
    refresh();
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    // A toolbar click or the shortcut gave access to a tab: its address is readable now.
    const offGrant = onGrant(refresh);
    return () => {
      alive = false;
      offGrant();
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);
  return tab;
}

export function PanelProvider({ children, onRoute }: { children: ReactNode; onRoute: (intent: PanelIntent) => void }) {
  const [loaded, setLoaded] = useState(false);
  const [all, setAll] = useState<BoardMeta[]>([]);
  const [board, setBoard] = useState<Board>();
  const [settings, setSettings] = useState<Settings>();
  const [storage, setStorage] = useState<StorageState>();
  const [notice, setNotice] = useState<Notice>();
  const [capture, setCapture] = useState<PendingCapture>();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const tab = useActiveTab();
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const onRouteRef = useRef(onRoute);
  onRouteRef.current = onRoute;

  const reload = useCallback(async () => {
    const [rows, s] = await Promise.all([listBoards(), loadSettings()]);
    const visible = rows.filter((r) => !hiddenRef.current.has(r.id));
    const recent = [...visible].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const currentId = visible.some((r) => r.id === s.lastBoardId) ? s.lastBoardId : recent?.id;
    const current = currentId ? await loadBoard(currentId) : undefined;
    setAll(rows);
    setSettings(s);
    setBoard(current);
    setLoaded(true);
  }, []);

  useEffect(() => {
    const run = () => void reload().catch((error: unknown) => console.error('Briefkord: could not load the boards', error));
    run();
    const offBoards = onBoardChanged(run);
    const onStorage = (changes: Record<string, unknown>, area: string) => area === 'local' && 'settings' in changes && run();
    browser.storage.onChanged.addListener(onStorage);
    const offIntents = takeIntents((intent) => {
      if (intent.capture) setCapture(intent.capture);
      if (intent.notice) setNotice(intent.notice);
      if (intent.route) onRouteRef.current(intent);
    });
    void storageState().then(setStorage);
    const online = () => void addMissingPreviews().catch((error: unknown) => console.error('Briefkord: could not add the preview images', error));
    window.addEventListener('online', online);
    void sweepOrphanFiles().catch((error: unknown) => console.error('Briefkord: could not tidy the board files', error));
    return () => {
      offBoards();
      offIntents();
      browser.storage.onChanged.removeListener(onStorage);
      window.removeEventListener('online', online);
    };
  }, [reload]);

  const hide = useCallback(
    (id: string, on: boolean) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        hiddenRef.current = next;
        return next;
      });
      void reload();
    },
    [reload],
  );

  const value = useMemo<PanelData>(
    () => ({
      loaded,
      boards: all.filter((b) => !hidden.has(b.id)),
      board,
      settings,
      tab,
      storage,
      notice,
      setNotice,
      capture,
      takeCapture: () => {
        setCapture(undefined);
        return capture;
      },
      hidden,
      hide,
    }),
    [loaded, all, board, settings, tab, storage, notice, capture, hidden, hide],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Opens the board tab at `#/b/<id>`, with optional search params such as `card`. */
export function openBoardTab(id: string, params: Record<string, string> = {}): void {
  const query = new URLSearchParams(params).toString();
  void browser.tabs.create({ url: browser.runtime.getURL(`/board.html#/b/${id}${query ? `?${query}` : ''}`) });
}

export function openImport(): void {
  void browser.tabs.create({ url: browser.runtime.getURL('/board.html#/import') });
}
