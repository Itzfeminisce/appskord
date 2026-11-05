/** One board in the tab: load, undo history, saving with a status, and reloads when another page changes it. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { canRedo, canUndo, commit as commitStep, createHistory, redo as redoStep, undo as undoStep, type History } from '@/lib/board/history';
import { newId } from '@/lib/board/ops';
import type { Board } from '@/lib/board/types';
import { validateBoard } from '@/lib/board/validate';
import { onBoardChanged } from '@/lib/store/channel';
import { loadBoard, updateBoard } from '@/lib/store/db';
import { sweepUnusedFiles } from '@/lib/store/files';
import { boardFiles } from '@/lib/share/prepare';
import { mergeBoards, outsideChange, rebaseHistory } from '@/lib/board/merge';
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
  /** The board as this page last read or wrote it: the base for merging another page's change. */
  const base = useRef<Board | undefined>(undefined);
  const seq = useRef({ changed: 0, saved: 0, saving: false, missed: false });
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reread = useRef<() => void>(() => undefined);

  const show = (next: History) => {
    history.current = next;
    setLoad({ state: 'ready', history: next });
  };

  const gone = () => {
    history.current = undefined;
    base.current = undefined;
    setLoad({ state: 'missing' });
  };

  const save = useCallback(async () => {
    const s = seq.current;
    if (s.saving) return;
    clearTimeout(retryTimer.current);
    while (history.current && base.current && s.changed !== s.saved) {
      const target = s.changed;
      const mine = history.current.present;
      const known = base.current;
      let outside = undefined as Board | undefined;
      let deleted = false as boolean;
      s.saving = true;
      setStatus('saving');
      try {
        // Saves merge: when another page wrote since `known`, its change is merged by card id under ours in the same transaction.
        const stored = await updateBoard(id, (latest) => {
          if (!latest) return void (deleted = true);
          if (latest.updatedAt === known.updatedAt) return mine;
          outside = latest;
          return mergeBoards(known, latest, mine);
        });
        s.saving = false;
        if (deleted || !stored) return gone();
        base.current = stored;
        s.saved = target;
        if (outside && history.current) {
          const change = outsideChange(known, outside);
          const rebased = rebaseHistory(history.current, change, history.current.present === mine ? stored : undefined);
          show(rebased);
        }
      } catch (error) {
        console.error('Briefkord: could not save the board', error);
        s.saving = false;
        setStatus('not-saved');
        setUnsaved(s.changed - s.saved);
        retryTimer.current = setTimeout(() => void save(), RETRY_MS);
        return;
      }
    }
    setUnsaved(0);
    setStatus('saved');
    if (s.missed) reread.current();
  }, [id]);

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
    base.current = undefined;
    seq.current = { changed: 0, saved: 0, saving: false, missed: false };
    setLoad({ state: 'opening' });
    setStatus('saved');
    const read = async (initial: boolean) => {
      try {
        const raw = await loadBoard(id);
        if (!alive) return;
        const s = seq.current;
        if (!raw) {
          // Deleted in another page: stop here rather than saving it back without its files.
          if (initial || history.current) gone();
          return;
        }
        const checked = validateBoard(raw);
        if (!checked.ok) {
          console.error('Briefkord: could not read the board', checked.problems);
          if (initial) setLoad({ state: 'damaged', name: typeof raw.name === 'string' ? raw.name : '', copy: repairBoard(raw, newId(), Date.now()) });
          return;
        }
        const latest = checked.board;
        if (initial || !history.current || !base.current) {
          base.current = latest;
          show(createHistory(latest));
          if (initial) void sweepUnusedFiles(id, new Set(boardFiles(latest).map((f) => f.id))).catch((error: unknown) => console.error('Briefkord: could not tidy the board files', error));
          return;
        }
        // While saving or with edits not yet saved, the next save merges this change; look again once saving ends.
        if (s.saving || s.changed !== s.saved) return void (s.missed = true);
        s.missed = false;
        if (latest.updatedAt === base.current.updatedAt) return;
        show(rebaseHistory(history.current, outsideChange(base.current, latest), latest));
        base.current = latest;
      } catch (error) {
        console.error('Briefkord: could not load the board', error);
        if (alive && initial) setLoad({ state: 'missing' });
      }
    };
    reread.current = () => void read(false);
    void read(true);
    const stop = onBoardChanged((changed) => changed === id && void read(false));
    return () => {
      alive = false;
      reread.current = () => undefined;
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
