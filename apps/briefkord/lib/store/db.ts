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
  const files = [...new Map(Object.values(board.cards).flatMap(filesOf).map((f) => [f.id, f.size])).values()].reduce((sum, size) => sum + size, 0);
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

/**
 * Reads the stored board, changes it and writes the result in one transaction, so no other page's write in between is lost.
 * `change` must be synchronous; returning undefined (or the same board) writes nothing. Each write moves `updatedAt` past the
 * stored one, so `updatedAt` works as the board's revision. Resolves to the board as written, or undefined.
 */
export async function updateBoard(id: string, change: (latest: Board | undefined) => Board | undefined): Promise<Board | undefined> {
  const tx = (await boardsDB.get()).transaction(['boards', 'meta'], 'readwrite');
  const done = tx.done.catch((error: unknown) => error);
  let written: Board | undefined;
  try {
    const latest = await tx.objectStore('boards').get(id);
    const next = change(latest);
    if (next && next !== latest) {
      if (next.id !== id) throw new Error(`Briefkord: board ${next.id} saved as ${id}`);
      const checked = validateBoard(next);
      if (!checked.ok) throw new Error(`Briefkord: board ${id} is not valid: ${checked.problems.join('; ')}`);
      written = latest && next.updatedAt <= latest.updatedAt ? { ...next, updatedAt: latest.updatedAt + 1 } : next;
      await Promise.all([tx.objectStore('boards').put(written), tx.objectStore('meta').put(boardMeta(written))]);
    }
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already finished.
    }
    await done;
    throw error;
  }
  const failed = await done;
  if (failed) throw failed;
  if (written) postBoardChanged(id);
  return written;
}

/** Saves a board and its row, then tells other pages. A board that fails the validator is refused. Resolves to the board as written. */
export async function saveBoard(board: Board): Promise<Board> {
  return (await updateBoard(board.id, () => board))!;
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
