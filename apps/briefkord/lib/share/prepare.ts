/** What a shared file holds: the board without the owner's notes or page text when those are off. Pure. */
import type { Board, Card, FileRef } from '../board/types';

export interface ShareOptions {
  /** "Include my notes": each card's "What to say about it". */
  notes: boolean;
  /** "Include saved page text": a link card's saved text. */
  pageText: boolean;
}

/** The files a card keeps in OPFS. */
export function cardFiles(card: Card): FileRef[] {
  if (card.kind === 'image' || card.kind === 'file') return [card.file];
  if (card.kind === 'link' && card.preview) return [card.preview];
  return [];
}

/** Every file on the board, once each. */
export function boardFiles(board: Board): FileRef[] {
  const seen = new Map<string, FileRef>();
  for (const card of Object.values(board.cards)) for (const f of cardFiles(card)) seen.set(f.id, f);
  return [...seen.values()];
}

/** The board as it goes into a file: no import marks, and notes and page text only when asked for. */
export function prepareForShare(board: Board, options: ShareOptions): Board {
  const cards: Record<string, Card> = {};
  for (const [id, card] of Object.entries(board.cards)) {
    const { mark: _mark, ...rest } = card;
    let next = rest as Card;
    if (!options.notes) next = { ...next, say: '' };
    if (!options.pageText && next.kind === 'link') next = { ...next, text: '', words: 0 };
    cards[id] = next;
  }
  const { imported: _imported, ...rest } = board;
  return { ...rest, cards };
}

/** "checkout-redesign-review.html" from "Checkout redesign review". */
export function shareFileName(name: string, ext: 'html' | 'briefkord'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'board'}.${ext}`;
}

/** Bytes as the frames write them: "8.4 MB", "212 MB", "412 KB". */
export function formatBytes(bytes: number): string {
  const trim = (n: number): string => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));
  if (bytes >= 1e9) return `${trim(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${trim(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Nov" or, with the year, "3 Nov 2026". */
export function formatDay(at: number, withYear = false): string {
  const d = new Date(at);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? ` ${d.getFullYear()}` : ''}`;
}

/** "16:40" */
export function formatTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
