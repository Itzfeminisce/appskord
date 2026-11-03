/** Boards in IndexedDB `briefkord`: the board itself and its list row, always written together. */
import { createDB, type DBSchema } from '@appskord/platform';
import { validateBoard } from '../board/validate';
import type { Board, BoardMeta, Card, FileRef } from '../board/types';
import { postBoardChanged } from './channel';
import { deleteBoardFiles } from './files';

interface BriefkordDB extends DBSchema {
  boards: { key: string; value: Board };
  meta: { key: string; value: BoardMeta };
}

export const boardsDB = createDB<BriefkordDB>({
  name: 'briefkord',
  version: 1,
  upgrade(db) {
    db.createObjectStore('boards', { keyPath: 'id' });
    db.createObjectStore('meta', { keyPath: 'id' });
  },
});

const filesOf = (card: Card): FileRef[] => {
  if (card.kind === 'image' || card.kind === 'file') return [card.file];
  if (card.kind === 'link' && card.preview) return [card.preview];
  return [];
};

/** The list row for a board; `bytes` counts its JSON and its stored files. */
export function boardMeta(board: Board): BoardMeta {
  const files = Object.values(board.cards).flatMap(filesOf).reduce((sum, f) => sum + f.size, 0);
  const json = new TextEncoder().encode(JSON.stringify(board)).byteLength;
  return {
    id: board.id,
    name: board.name,
    pinned: board.pinned,
    cards: Object.keys(board.cards).length,
    updatedAt: board.updatedAt,
    bytes: json + files,
    ...(board.imported ? { imported: board.imported } : {}),
  };
}

/** Saves a board and its row in one transaction, then tells other pages. A board that fails the validator is refused. */
export async function saveBoard(board: Board): Promise<void> {
  const checked = validateBoard(board);
  if (!checked.ok) throw new Error(`Briefkord: board ${board.id} is not valid: ${checked.problems.join('; ')}`);
  const tx = (await boardsDB.get()).transaction(['boards', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('boards').put(board), tx.objectStore('meta').put(boardMeta(board)), tx.done]);
  postBoardChanged(board.id);
}

export async function loadBoard(id: string): Promise<Board | undefined> {
  return (await boardsDB.get()).get('boards', id);
}

export async function loadAllBoards(): Promise<Board[]> {
  return (await boardsDB.get()).getAll('boards');
}

/** Board rows, pinned first, then the most recently changed. */
export async function listBoards(): Promise<BoardMeta[]> {
  const rows = await (await boardsDB.get()).getAll('meta');
  return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** Deletes a board, its row and its files folder. */
export async function deleteBoard(id: string): Promise<void> {
  const tx = (await boardsDB.get()).transaction(['boards', 'meta'], 'readwrite');
  await Promise.all([tx.objectStore('boards').delete(id), tx.objectStore('meta').delete(id), tx.done]);
  await deleteBoardFiles(id);
  postBoardChanged(id);
}
