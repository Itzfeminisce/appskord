import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { sampleBoard } from '../board/sample';
import type { Board, Card, LinkCard } from '../board/types';
import { validateBoard } from '../board/validate';
import { packEditFile, unpackEditFile, type EditPackage } from './editFile';
import { importedId, originId, toOriginIds } from './ids';
import { findOwnBoard, importBoard, importName, markOf } from './importBoard';
import { formatBytes, formatDay, prepareForShare, shareFileName } from './prepare';
import { estimateViewBytes, filesToLeaveOut, VIEW_FILE_LIMIT } from './size';

const T = 1_762_187_000_000;
const withNotes = (): Board => {
  const board = sampleBoard(T, 'board-a');
  const link = board.cards.findings as LinkCard;
  board.cards.findings = { ...link, text: 'Saved page words', words: 3 };
  return board;
};
const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
const pkg = (board: Board, files: Record<string, Uint8Array> = {}): EditPackage => ({ board, from: { person: 'Ada', at: T }, files });

describe('prepareForShare', () => {
  it('strips notes and page text when they are off', () => {
    const out = prepareForShare(withNotes(), { notes: false, pageText: false });
    expect(Object.values(out.cards).every((c) => c.say === '')).toBe(true);
    expect((out.cards.findings as LinkCard).text).toBe('');
    expect((out.cards.findings as LinkCard).words).toBe(0);
    expect(validateBoard(out).ok).toBe(true);
  });

  it('keeps them when they are on, and always drops import marks', () => {
    const board = withNotes();
    board.cards['why-now'] = { ...board.cards['why-now']!, mark: 'changed' };
    board.imported = { person: 'Ada', at: T, changed: 1, added: 0 };
    const out = prepareForShare(board, { notes: true, pageText: true });
    expect(out.cards.findings!.say).toBe('Findings 4 and 11 match what support hears.');
    expect((out.cards.findings as LinkCard).text).toBe('Saved page words');
    expect(out.cards['why-now']!.mark).toBeUndefined();
    expect(out.imported).toBeUndefined();
  });

  it('names files and sizes as the frames do', () => {
    expect(shareFileName('Checkout redesign review', 'html')).toBe('checkout-redesign-review.html');
    expect(shareFileName('  ', 'briefkord')).toBe('board.briefkord');
    expect(formatBytes(8_400_000)).toBe('8.4 MB');
    expect(formatBytes(212_000_000)).toBe('212 MB');
    expect(formatDay(new Date(2026, 10, 3).getTime(), true)).toBe('3 Nov 2026');
  });
});

describe('edit file', () => {
  it('packs and unpacks a board, its sender and its files', () => {
    const board = prepareForShare(withNotes(), { notes: true, pageText: true });
    const files = { 'step-2-png': bytes(300), 'report-pdf': bytes(500, 3) };
    const result = unpackEditFile(packEditFile(pkg(board, files)), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pkg.board).toEqual(board);
    expect(result.pkg.from).toEqual({ person: 'Ada', at: T });
    expect(result.pkg.files['report-pdf']).toEqual(files['report-pdf']);
    expect(Object.keys(result.pkg.files).sort()).toEqual(['report-pdf', 'step-2-png']);
  });

  it('tells a foreign file from a damaged one', () => {
    expect(unpackEditFile(strToU8('hello'))).toEqual({ ok: false, error: 'not-briefkord' });
    expect(unpackEditFile(strToU8('hello'), true)).toEqual({ ok: false, error: 'damaged' });
    expect(unpackEditFile(zipSync({ 'notes.txt': strToU8('x') }))).toEqual({ ok: false, error: 'not-briefkord' });
    const broken = zipSync({ 'meta.json': strToU8('{"app":"briefkord","format":1}'), 'board.json': strToU8('{"version":1,"cards":3}') });
    const result = unpackEditFile(broken, true);
    expect(result.ok === false && result.error).toBe('damaged');
  });

  it('refuses a file from a newer Briefkord', () => {
    const newer = zipSync({ 'meta.json': strToU8('{"app":"briefkord","format":2}'), 'board.json': strToU8('{}') });
    expect(unpackEditFile(newer, true)).toEqual({ ok: false, error: 'newer-version' });
    const newerBoard = zipSync({ 'meta.json': strToU8('{"app":"briefkord","format":1}'), 'board.json': strToU8('{"version":2}') });
    expect(unpackEditFile(newerBoard, true)).toEqual({ ok: false, error: 'newer-version' });
  });
});

describe('ids', () => {
  it('gives imported copies new ids that map back to the origin', () => {
    const id = importedId('n1', 'card-1');
    expect(id).not.toBe('card-1');
    expect(originId(id)).toBe('card-1');
    expect(importedId('n2', id)).toBe('n2~card-1');
  });

  it('exports a copy with origin ids, keeping its own new cards', () => {
    const own = sampleBoard(T, 'board-a');
    const copy = importBoard(pkg(own), undefined, { name: 'Copy', nonce: 'n1', now: T }).board;
    expect(copy.id).toBe('n1~board-a');
    expect(Object.keys(copy.cards)).toContain('n1~flow');
    const back = toOriginIds(copy);
    expect(back.id).toBe('board-a');
    expect(Object.keys(back.cards).sort()).toEqual(Object.keys(own.cards).sort());
    expect(validateBoard(back).ok).toBe(true);
  });
});

describe('import', () => {
  const own = sampleBoard(T, 'board-a');

  it('always makes a new board with new ids and the chosen name', () => {
    const { board, files } = importBoard(pkg(own, { 'step-2-png': bytes(4) }), undefined, { name: 'Checkout redesign review (from Ada)', nonce: 'n1', now: T + 5 });
    expect(board.id).not.toBe(own.id);
    expect(board.name).toBe('Checkout redesign review (from Ada)');
    expect(Object.keys(board.cards).every((id) => !own.cards[id])).toBe(true);
    expect((board.cards['n1~step-2'] as Card & { file: { id: string } }).file.id).toBe('n1~step-2-png');
    expect(Object.keys(files)).toEqual(['n1~step-2-png']);
    expect(board.imported).toBeUndefined();
    expect(Object.values(board.cards).some((c) => c.mark)).toBe(false);
    expect(validateBoard(board).ok).toBe(true);
  });

  it('marks cards the sender changed and added against the user\'s own board', () => {
    // Bob imports Ada's board, edits it and sends it back.
    const bobs = importBoard(pkg(own), undefined, { name: 'Checkout redesign review (from Ada)', nonce: 'bob', now: T }).board;
    const why = bobs.cards['bob~why-now']!;
    bobs.cards['bob~why-now'] = { ...why, title: 'Why now (updated)', rect: { ...why.rect, x: 0 } };
    const moved = bobs.cards['bob~report']!;
    bobs.cards['bob~report'] = { ...moved, rect: { ...moved.rect, x: 9 }, updatedAt: T + 99 };
    bobs.cards.extra = { ...why, id: 'extra', title: 'New idea' };
    bobs.sections[0]!.cards.push('extra');
    const sent = toOriginIds(prepareForShare(bobs, { notes: false, pageText: true }));
    const unpacked = unpackEditFile(packEditFile({ board: sent, from: { person: 'Bob', at: T }, files: {} }), true);
    if (!unpacked.ok) throw new Error(unpacked.error);

    const mine = findOwnBoard([sampleBoard(T, 'other'), own], unpacked.pkg.board.id);
    expect(mine?.id).toBe('board-a');
    const { board } = importBoard(unpacked.pkg, mine, { name: '', nonce: 'n2', now: T + 9 });
    const marks = Object.values(board.cards).filter((c) => c.mark).map((c) => [originId(c.id), c.mark]);
    expect(marks.sort()).toEqual([['extra', 'added'], ['why-now', 'changed']]);
    expect(board.imported).toEqual({ person: 'Bob', at: T + 9, changed: 1, added: 1 });
    expect(board.name).toBe('Checkout redesign review (from Bob)');
  });

  it('does not count notes the sender left out as changes', () => {
    const sent = prepareForShare(own, { notes: false, pageText: false });
    expect(markOf(sent.cards.flow!, own)).toBeUndefined();
    expect(markOf({ ...sent.cards.flow!, say: 'A new note' }, own)).toBe('changed');
  });

  it('drops an old "(from …)" from the name', () => {
    expect(importName('Review (from Ada)', 'Bob')).toBe('Review (from Bob)');
  });
});

describe('view file size', () => {
  it('leaves out the largest files until the view file fits', () => {
    const board = sampleBoard(T);
    const big = (id: string, size: number) => ({ ...board.cards[id]!, file: { ...(board.cards[id] as Card & { file: { id: string } }).file, size } }) as Card;
    board.cards['step-2'] = big('step-2', 30_000_000);
    board.cards.report = big('report', 20_000_000);
    expect(estimateViewBytes(board, 100_000)).toBeGreaterThan(VIEW_FILE_LIMIT);
    expect(filesToLeaveOut(board, 100_000)).toEqual(['step-2-png']);
    expect(filesToLeaveOut(sampleBoard(T), 100_000)).toEqual([]);
  });
});
