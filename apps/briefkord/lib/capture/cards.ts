/** Builds the cards a capture adds and places them on a board: the chosen section's end, a free spot on the canvas. */
import { addCard } from '../board/ops';
import type { Board, BoardMeta, FileRef, ImageCard, LinkCard, NoteCard, Section } from '../board/types';
import { freeSpot } from './place';
import { siteName, titleFrom } from './text';

export const CARD_SIZE = { link: { w: 264, h: 214 }, linkBare: { w: 264, h: 120 }, image: { w: 264, h: 210 }, note: { w: 220, h: 150 } };

const base = (id: string, now: number) => ({ id, colour: 'white' as const, z: 0, say: '', createdAt: now, updatedAt: now });

export function linkCard(id: string, now: number, page: { url: string; title: string; text: string; words: number; preview?: FileRef }): LinkCard {
  const size = page.preview ? CARD_SIZE.link : CARD_SIZE.linkBare;
  return {
    ...base(id, now),
    kind: 'link',
    title: page.title.trim() || siteName(page.url),
    rect: { x: 0, y: 0, ...size },
    url: page.url,
    site: siteName(page.url),
    text: page.text,
    words: page.words,
    savedAt: now,
    ...(page.preview ? { preview: page.preview } : {}),
  };
}

/** An image card 264 wide, as tall as the image's shape allows (120 to 400). */
export function imageCard(id: string, now: number, image: { file: FileRef; title: string; pageUrl?: string; width?: number; height?: number }): ImageCard {
  const ratio = image.width && image.height ? image.height / image.width : CARD_SIZE.image.h / CARD_SIZE.image.w;
  const h = Math.round(Math.min(400, Math.max(120, CARD_SIZE.image.w * ratio)));
  return {
    ...base(id, now),
    kind: 'image',
    title: image.title.trim() || image.file.name,
    rect: { x: 0, y: 0, w: CARD_SIZE.image.w, h },
    file: image.file,
    ...(image.pageUrl ? { pageUrl: image.pageUrl } : {}),
  };
}

/** A yellow note; its title is the first line of the text. */
export function noteCard(id: string, now: number, text: string): NoteCard {
  return { ...base(id, now), kind: 'note', colour: 'yellow', title: titleFrom(text), rect: { x: 0, y: 0, ...CARD_SIZE.note }, text: text.trim() };
}

/** The section new cards go to: the remembered one when it is on this board, else the last. */
export function targetSection(board: Board, sectionId?: string): Section {
  return board.sections.find((s) => s.id === sectionId) ?? board.sections[board.sections.length - 1]!;
}

/** Adds `card` at the end of the section and at a free spot on the canvas. */
export function placeCard<C extends LinkCard | ImageCard | NoteCard>(board: Board, card: C, now: number, sectionId?: string): Board {
  const spot = freeSpot(Object.values(board.cards).map((c) => c.rect), card.rect);
  return addCard(board, { ...card, rect: { ...card.rect, ...spot } }, now, { sectionId: targetSection(board, sectionId).id });
}

/** Boards for the right-click menu: the last one saved to first, then the most recently edited. */
export function lastUsedFirst(boards: readonly BoardMeta[], lastBoardId?: string): BoardMeta[] {
  return [...boards].sort((a, b) => Number(b.id === lastBoardId) - Number(a.id === lastBoardId) || b.updatedAt - a.updatedAt);
}
