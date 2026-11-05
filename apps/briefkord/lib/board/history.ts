/** Undo and redo over immutable boards: every user change is one `commit`. */
import type { Board } from './types';

export const HISTORY_LIMIT = 100;

export interface History { past: Board[]; present: Board; future: Board[] }

export const createHistory = (board: Board): History => ({ past: [], present: board, future: [] });

/** Records a change; the oldest step falls off past the limit, and redo is cleared. */
export function commit(history: History, next: Board): History {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(history: History): History {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: History): History {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future };
}

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;
