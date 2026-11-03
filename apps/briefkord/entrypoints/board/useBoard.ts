/** One board in the tab: load, undo history, saving with a status, and reloads when another page changes it. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canRedo, canUndo, commit as commitStep, createHistory, redo as redoStep, undo as undoStep, type History } from '@/lib/board/history';
import { newId } from '@/lib/board/ops';
import type { Board } from '@/lib/board/types';
import { validateBoard } from '@/lib/board/validate';
import { onBoardChanged } from '@/lib/store/channel';
import { loadBoard, saveBoard } from '@/lib/store/db';
import { repairBoard } from './logic/repair';

export type SaveStatus = 'saved' | 'saving' | 'not-saved';

export type BoardLoad =
  | { state: 'opening' }
  | { state: 'missing' }
  | { state: 'damaged'; name: string; copy?: Board }
  | { state: 'ready'; history: History };

export interface BoardApi {
  load: BoardLoad;
  /** The board on screen, once ready. */
  board: Board | undefined;
  status: SaveStatus;
  /** Changes made since the last save that worked. */
  unsaved: number;
  /** Records one undo step and saves it. */
  commit(next: Board): void;
  /** `commit(edit(board, now))` on the current board. */
  change(edit: (board: Board, now: number) => Board): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  /** "Try now" after a failed save. */
  retry(): void;
}

const RETRY_MS = 4000;

export function useBoard(id: string): BoardApi {
  const [load, setLoad] = useState<BoardLoad>({ state: 'opening' });
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [unsaved, setUnsaved] = useState(0);
  const history = useRef<History | undefined>(undefined);
  const seq = useRef({ changed: 0, saved: 0, saving: false });
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = (next: History) => {
    history.current = next;
    setLoad({ state: 'ready', history: next });
  };

  const save = useCallback(async () => {
    const s = seq.current;
    if (s.saving) return;
    clearTimeout(retryTimer.current);
    while (history.current && s.changed !== s.saved) {
      const target = s.changed;
      const board = history.current.present;
      s.saving = true;
      setStatus('saving');
      try {
        await saveBoard(board);
        s.saved = target;
      } catch (error) {
        console.error('Briefkord: could not save the board', error);
        s.saving = false;
        setStatus('not-saved');
        setUnsaved(s.changed - s.saved);
        retryTimer.current = setTimeout(() => void save(), RETRY_MS);
        return;
      }
      s.saving = false;
    }
    setUnsaved(0);
    setStatus('saved');
  }, []);

  const replace = useCallback(
    (next: History) => {
      if (next === history.current) return;
      show(next);
      seq.current.changed += 1;
      void save();
    },
    [save],
  );

  useEffect(() => {
    let alive = true;
    history.current = undefined;
    seq.current = { changed: 0, saved: 0, saving: false };
    setLoad({ state: 'opening' });
    setStatus('saved');
    const read = async (initial: boolean) => {
      try {
        const raw = await loadBoard(id);
        if (!alive) return;
        if (!raw) {
          if (initial) setLoad({ state: 'missing' });
          return;
        }
        const checked = validateBoard(raw);
        if (!checked.ok) {
          console.error('Briefkord: could not read the board', checked.problems);
          if (initial) setLoad({ state: 'damaged', name: typeof raw.name === 'string' ? raw.name : '', copy: repairBoard(raw, newId(), Date.now()) });
          return;
        }
        const s = seq.current;
        const present = history.current?.present;
        // Our own saves come back on the channel too; only another page's change replaces the board.
        if (!initial && (s.saving || s.changed !== s.saved || present?.updatedAt === checked.board.updatedAt)) return;
        show(createHistory(checked.board));
      } catch (error) {
        console.error('Briefkord: could not load the board', error);
        if (alive && initial) setLoad({ state: 'missing' });
      }
    };
    void read(true);
    const stop = onBoardChanged((changed) => changed === id && void read(false));
    return () => {
      alive = false;
      stop();
      clearTimeout(retryTimer.current);
    };
  }, [id]);

  const board = load.state === 'ready' ? load.history.present : undefined;
  const ready = load.state === 'ready' ? load.history : undefined;

  const commit = useCallback((next: Board) => history.current && replace(commitStep(history.current, next)), [replace]);
  const change = useCallback((edit: (b: Board, now: number) => Board) => history.current && replace(commitStep(history.current, edit(history.current.present, Date.now()))), [replace]);
  const undo = useCallback(() => history.current && replace(undoStep(history.current)), [replace]);
  const redo = useCallback(() => history.current && replace(redoStep(history.current)), [replace]);
  const retry = useCallback(() => void save(), [save]);

  return useMemo(
    () => ({ load, board, status, unsaved, commit, change, undo, redo, retry, canUndo: ready ? canUndo(ready) : false, canRedo: ready ? canRedo(ready) : false }),
    [load, board, status, unsaved, commit, change, undo, redo, retry, ready],
  );
}
