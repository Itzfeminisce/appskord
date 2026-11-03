/** New cards, copies and the words the board writes about a card. Pure: ids and times come from the caller. */
import type { Card, CardKind, ChecklistCard, DiagramCard, FileCard, FileRef, ImageCard, NoteCard, Rect } from '@/lib/board/types';

export const CARD_SIZE: Record<CardKind, { w: number; h: number }> = {
  note: { w: 220, h: 150 },
  checklist: { w: 220, h: 176 },
  diagram: { w: 380, h: 262 },
  link: { w: 264, h: 214 },
  image: { w: 264, h: 210 },
  file: { w: 228, h: 120 },
};

/** "Image", "Link"…: the kind as the search and card header name it. */
export const KIND_LABEL: Record<CardKind, string> = { link: 'Link', image: 'Image', note: 'Note', file: 'File', checklist: 'Checklist', diagram: 'Diagram' };

const base = (id: string, at: { x: number; y: number }, kind: CardKind, now: number) => ({
  id,
  title: '',
  colour: 'white' as const,
  rect: { x: at.x, y: at.y, ...CARD_SIZE[kind] },
  z: 0,
  say: '',
  createdAt: now,
  updatedAt: now,
});

export const newNote = (id: string, at: { x: number; y: number }, now: number): NoteCard => ({ ...base(id, at, 'note', now), kind: 'note', colour: 'yellow', text: '' });
export const newChecklist = (id: string, at: { x: number; y: number }, now: number): ChecklistCard => ({ ...base(id, at, 'checklist', now), kind: 'checklist', items: [] });
export const newDiagram = (id: string, at: { x: number; y: number }, now: number): DiagramCard => ({ ...base(id, at, 'diagram', now), kind: 'diagram', diagram: { nodes: [], edges: [] } });

/** An image card sized to the picture's shape, or a file card, for a stored file. */
export function newFileCard(id: string, at: { x: number; y: number }, file: FileRef, now: number, image?: { w: number; h: number }): ImageCard | FileCard {
  if (file.mime.startsWith('image/')) {
    const w = CARD_SIZE.image.w;
    const picture = image && image.w > 0 ? Math.round(Math.min(Math.max((w * image.h) / image.w, 80), 360)) : 162;
    return { ...base(id, at, 'image', now), kind: 'image', title: file.name.replace(/\.[^.]+$/, ''), file, rect: { x: at.x, y: at.y, w, h: picture + 48 } };
  }
  return { ...base(id, at, 'file', now), kind: 'file', title: file.name, file };
}

/** Only web addresses open from a card; an imported card may name chrome:// or file:// pages. */
export const webUrl = (url: string | undefined): string | undefined => (url && /^https?:\/\//i.test(url) ? url : undefined);

/** The card with each of its files under a new id from `fileId`, and which stored file each new id copies. */
export function withNewFiles(card: Card, fileId: () => string): { card: Card; copies: { from: FileRef; to: string }[] } {
  const copies: { from: FileRef; to: string }[] = [];
  const moved = (from: FileRef): FileRef => {
    const to = fileId();
    copies.push({ from, to });
    return { ...from, id: to };
  };
  if (card.kind === 'image' || card.kind === 'file') return { card: { ...card, file: moved(card.file) }, copies };
  if (card.kind === 'link' && card.preview) return { card: { ...card, preview: moved(card.preview) }, copies };
  return { card, copies };
}

/** A copy of a card, offset so both show, with a new id. Its files keep their ids; `withNewFiles` gives it its own. */
export function duplicateCard(card: Card, id: string, now: number, offset = 24): Card {
  const rect: Rect = { ...card.rect, x: card.rect.x + offset, y: card.rect.y + offset };
  const { mark: _mark, ...rest } = card;
  return { ...rest, id, rect, createdAt: now, updatedAt: now } as Card;
}

/** "3 Nov". */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "3 Nov, 09:12". */
export function dateTime(ms: number): string {
  const d = new Date(ms);
  return `${shortDate(ms)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "12 min ago" within the hour, "today", then "2 Nov". */
export function lastEdit(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  if (new Date(ms).toDateString() === new Date(now).toDateString()) return 'today';
  return shortDate(ms);
}

/** "1 card" / "7 cards". */
export const cardsCount = (n: number): string => `${n} ${n === 1 ? 'card' : 'cards'}`;

export const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
