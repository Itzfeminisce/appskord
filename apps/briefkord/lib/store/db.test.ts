import { afterEach, describe, expect, it, vi } from 'vitest';
import { renameBoard, setPinned } from '../board/ops';
import { sampleBoard } from '../board/sample';
import { onBoardChanged } from './channel';
import { addCard, updateCard } from '../board/ops';
import { boardMeta, boardsDB, deleteBoard, listBoards, loadAllBoards, loadBoard, saveBoard, updateBoard } from './db';
import { deleteBoardFiles } from './files';

vi.mock('./files', () => ({ deleteBoardFiles: vi.fn(async () => {}) }));

afterEach(async () => {
  await boardsDB.close();
  indexedDB.deleteDatabase('briefkord');
});

describe('board storage', () => {
  it('saves a board with its list row and loads it back', async () => {
    const board = sampleBoard(1000, 'b1');
    await saveBoard(board);
    expect(await loadBoard('b1')).toEqual(board);
    const [row] = await listBoards();
    expect(row).toEqual(boardMeta(board));
    expect(row).toMatchObject({ id: 'b1', name: 'Checkout redesign review', cards: 7, pinned: false });
    // JSON plus the image (412 000 bytes) and the PDF (2 400 000 bytes).
    expect(row!.bytes).toBeGreaterThan(2_812_000);
  });

  it('lists pinned boards first, then the most recently changed', async () => {
    await saveBoard(sampleBoard(1, 'old'));
    await saveBoard(renameBoard(sampleBoard(1, 'new'), 'Newer', 9));
    await saveBoard(setPinned(sampleBoard(1, 'pinned'), true, 2));
    expect((await listBoards()).map((m) => m.id)).toEqual(['pinned', 'new', 'old']);
    expect((await loadAllBoards()).map((b) => b.id).sort()).toEqual(['new', 'old', 'pinned']);
  });

  it('refuses a board that fails the validator', async () => {
    const broken = sampleBoard(1, 'bad');
    broken.sections = [];
    await expect(saveBoard(broken)).rejects.toThrow('is not valid');
    expect(await loadBoard('bad')).toBeUndefined();
  });

  it('deletes a board, its row and its files', async () => {
    await saveBoard(sampleBoard(1, 'b1'));
    await deleteBoard('b1');
    expect(await loadBoard('b1')).toBeUndefined();
    expect(await listBoards()).toEqual([]);
    expect(deleteBoardFiles).toHaveBeenCalledWith('b1');
  });

  it('changes the newest stored board in one step and moves updatedAt past it', async () => {
    const stored = await saveBoard(sampleBoard(5, 'b1'));
    const older = updateCard(sampleBoard(1, 'b1'), 'why-now', 2, (c) => ({ ...c, title: 'Old copy' }));
    const written = await updateBoard('b1', () => older);
    expect(written!.updatedAt).toBe(stored.updatedAt + 1);
    const note = { ...sampleBoard(1, 'x').cards['why-now']!, id: 'n1' };
    const both = await Promise.all([1, 2].map((i) => updateBoard('b1', (b) => b && addCard(b, { ...note, id: `n${i}` }, 9))));
    expect(both.every(Boolean)).toBe(true);
    const latest = (await loadBoard('b1'))!;
    expect(Object.keys(latest.cards)).toEqual(expect.arrayContaining(['n1', 'n2']));
    expect(latest.cards['why-now']!.title).toBe('Old copy');
  });

  it('writes nothing for a board that is gone, and nothing invalid', async () => {
    expect(await updateBoard('none', (b) => b)).toBeUndefined();
    expect(await loadBoard('none')).toBeUndefined();
    await saveBoard(sampleBoard(1, 'b1'));
    await expect(updateBoard('b1', (b) => b && { ...b, sections: [] })).rejects.toThrow('is not valid');
    expect((await loadBoard('b1'))!.sections).toHaveLength(3);
  });

  it('counts a file two cards share once', () => {
    const board = sampleBoard(1, 'b1');
    const image = board.cards['step-2']!;
    const twice = { ...board, cards: { ...board.cards, copy: { ...image, id: 'copy' } }, sections: [{ ...board.sections[0]!, cards: [...board.sections[0]!.cards, 'copy'] }, ...board.sections.slice(1)] };
    expect(boardMeta(twice).bytes - boardMeta(board).bytes).toBeLessThan(1000);
  });

  it('tells other pages about every write', async () => {
    const seen: string[] = [];
    const stop = onBoardChanged((id) => seen.push(id));
    await saveBoard(sampleBoard(1, 'b1'));
    await deleteBoard('b1');
    await vi.waitFor(() => expect(seen).toEqual(['b1', 'b1']));
    stop();
  });
});
