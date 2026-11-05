import { describe, expect, it } from 'vitest';
import { emptyBoard } from '../board/ops';
import { validateBoard } from '../board/validate';
import type { BoardMeta, Rect } from '../board/types';
import { lastUsedFirst, linkCard, noteCard, placeCard, quoteCard } from './cards';
import { freeSpot, PLACE_GAP, PLACE_ORIGIN } from './place';
import { ago, cleanText, formatBytes, imageFileName, isChromePage, onDay, siteName, titleFrom, wordCount } from './text';

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('page text', () => {
  it('collapses spaces and blank lines', () => {
    expect(cleanText('  Hello \t  world \n\n\n  next line  ')).toBe('Hello world\nnext line');
  });
  it('cuts long text on a word boundary', () => {
    const text = cleanText('alpha beta gamma delta', 13);
    expect(text).toBe('alpha beta');
    expect(cleanText('abcdefghij', 4)).toBe('abcd');
  });
  it('counts words', () => {
    expect(wordCount('')).toBe(0);
    expect(wordCount('  one two\nthree  ')).toBe(3);
  });
});

describe('site names and Chrome pages', () => {
  it('names the site without www', () => {
    expect(siteName('https://www.baymard.com/blog/checkout')).toBe('baymard.com');
    expect(siteName('https://docs.google.com/x')).toBe('docs.google.com');
    expect(siteName('file:///home/ada/notes.html')).toBe('File on this computer');
    expect(siteName('not a url')).toBe('not a url');
  });
  it('knows the pages Chrome keeps to itself', () => {
    expect(isChromePage('chrome://extensions')).toBe(true);
    expect(isChromePage('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isChromePage('about:blank')).toBe(true);
    expect(isChromePage('https://baymard.com/')).toBe(false);
  });
});

describe('titles and names', () => {
  it('takes the first line and cuts it with an ellipsis', () => {
    expect(titleFrom('Ask Sam about the coupon field\nmore')).toBe('Ask Sam about the coupon field');
    const long = titleFrom('word '.repeat(40), 20);
    expect(long.endsWith('…')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(20);
  });
  it('names an image file from its address', () => {
    expect(imageFileName('https://x.com/img/step%202.png?w=2', 'image/png')).toBe('step 2.png');
    expect(imageFileName('https://x.com/img/photo', 'image/jpeg')).toBe('photo.jpg');
    expect(imageFileName('data:image/png;base64,AAA', 'image/png')).toBe('image.png');
  });
  it('says sizes the way the frames do', () => {
    expect(formatBytes(84 * 1024 * 1024)).toBe('84 MB');
    expect(formatBytes(1.8 * 1024 ** 3)).toBe('1.8 GB');
    expect(formatBytes(412_000)).toBe('402 KB');
  });
  it('says when, the way the panel does', () => {
    const now = new Date(2026, 10, 3, 15, 0).getTime();
    expect(ago(now - 20_000, now)).toBe('just now');
    expect(ago(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(ago(now - 65 * 60_000, now)).toBe('1 h ago');
    expect(ago(new Date(2026, 10, 2, 9).getTime(), now)).toBe('yesterday');
    expect(ago(new Date(2026, 9, 28, 9).getTime(), now)).toBe('28 Oct');
    expect(onDay(now - 60_000, now)).toBe('today');
  });
});

describe('placing new cards', () => {
  it('puts the first card at the origin', () => {
    expect(freeSpot([], { w: 200, h: 100 })).toEqual(PLACE_ORIGIN);
  });
  it('finds a hole that keeps the gap clear', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 200, h: 200 },
      { x: 600, y: 0, w: 200, h: 200 },
    ];
    const spot = freeSpot(rects, { w: 200, h: 100 });
    const placed = { ...spot, w: 200, h: 100 };
    expect(spot.y).toBe(0);
    for (const r of rects) expect(overlap(placed, { x: r.x - PLACE_GAP, y: r.y - PLACE_GAP, w: r.w + 2 * PLACE_GAP, h: r.h + 2 * PLACE_GAP })).toBe(false);
  });
  it('never overlaps on a crowded board', () => {
    const rects: Rect[] = Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) * 230, y: Math.floor(i / 10) * 230, w: 220, h: 220 }));
    const spot = freeSpot(rects, { w: 264, h: 214 });
    for (const r of rects) expect(overlap({ ...spot, w: 264, h: 214 }, r)).toBe(false);
  });
  it('adds the card at the end of the chosen section and keeps the board valid', () => {
    let board = emptyBoard({ board: 'b', section: 's1' }, 'Board', 'Agenda', 1);
    board = { ...board, sections: [...board.sections, { id: 's2', title: 'Research', minutes: 0, cards: [] }] };
    board = placeCard(board, noteCard('n1', 2, 'First'), 2, 's1');
    board = placeCard(board, linkCard('l1', 3, { url: 'https://baymard.com/', title: 'Findings', text: 'a b', words: 2 }), 3, 's1');
    board = placeCard(board, noteCard('n2', 4, 'Elsewhere'), 4, 'missing');
    expect(board.sections[0]!.cards).toEqual(['n1', 'l1']);
    expect(board.sections[1]!.cards).toEqual(['n2']);
    expect(overlap(board.cards.n1!.rect, board.cards.l1!.rect)).toBe(false);
    expect(validateBoard(board).ok).toBe(true);
  });
});

describe('right-click board order', () => {
  it('puts the last used board first, then the most recently edited', () => {
    const meta = (id: string, updatedAt: number): BoardMeta => ({ id, name: id, pinned: false, cards: 0, updatedAt, bytes: 0 });
    expect(lastUsedFirst([meta('a', 3), meta('b', 1), meta('c', 2)], 'b').map((b) => b.id)).toEqual(['b', 'a', 'c']);
  });

  it('sizes a saved selection to its quote, up to a cap', () => {
    const source = { url: 'https://example.com/a', title: 'A' };
    const short = quoteCard('q1', 1, 'Short quote.', source);
    const long = quoteCard('q2', 1, 'word '.repeat(80), source);
    const huge = quoteCard('q3', 1, 'word '.repeat(2000), source);
    expect(short.rect).toMatchObject({ w: 280, h: 133 });
    expect(long.rect.h).toBeGreaterThan(short.rect.h);
    expect(huge.rect.h).toBe(360);
    expect(short.source).toEqual(source);
  });
});
