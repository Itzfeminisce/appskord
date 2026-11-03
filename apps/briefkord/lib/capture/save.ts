/** Saving what the user captures onto a board: the page, an image, selected text or a quick note. Shared by the panel and the background. */
import { deleteCards, newId, updateCard } from '../board/ops';
import type { Board, Card, FileRef, ImageCard, LinkCard, NoteCard } from '../board/types';
import { loadBoard, saveBoard } from '../store/db';
import { deleteFile, MAX_FILE_BYTES, writeFile } from '../store/files';
import { saveSettings } from '../store/settings';
import { imageCard, linkCard, noteCard, placeCard, quoteCard, targetSection } from './cards';
import type { PendingCapture } from './intent';
import { pageImage, pageImageBlob } from './pageImage';
import { readPage } from './readPage';
import type { CaptureProblem } from './result';
import { imageFileName, titleFrom } from './text';

/** Less free space than this and new images and files are refused (StatesPanel `storage-low`). */
export const LOW_SPACE_BYTES = 300 * 1024 * 1024;

export interface TabInfo { id: number; windowId: number; url?: string; title?: string }

export type Saved = { ok: true; board: Board; card: Card; offline?: boolean };
export type SaveProblem =
  | { ok: false; problem: 'cant-read'; reason: CaptureProblem }
  | { ok: false; problem: 'image-blocked' }
  | { ok: false; problem: 'file-too-big'; name: string; bytes: number }
  | { ok: false; problem: 'storage-low' }
  | { ok: false; problem: 'failed'; error: unknown };
export type SaveResult = Saved | SaveProblem;

export interface StorageState { low: boolean; used: number; free: number }

export async function storageState(): Promise<StorageState> {
  try {
    const { usage = 0, quota = Infinity } = await navigator.storage.estimate();
    const free = Math.max(0, quota - usage);
    return { low: free < LOW_SPACE_BYTES, used: usage, free };
  } catch {
    return { low: false, used: 0, free: Infinity };
  }
}

/** A smaller JPEG for card previews; the original when the browser cannot redraw it. */
async function shrink(blob: Blob, maxWidth = 800): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  } catch {
    return blob;
  }
}

/** The tab's preview: a picture of what it shows, else its og:image, else none. */
export async function previewImage(tab: TabInfo, previewUrl?: string): Promise<Blob | undefined> {
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 80 });
    return await shrink(await (await fetch(dataUrl)).blob());
  } catch {
    // No grant to picture the tab; try the page's own preview image.
  }
  if (!previewUrl) return undefined;
  const copied = await pageImage(tab.id, previewUrl);
  return copied.ok ? shrink(pageImageBlob(copied.value)) : undefined;
}

async function storeFile(boardId: string, blob: Blob, name: string): Promise<FileRef> {
  const file: FileRef = { id: newId(), name, mime: blob.type || 'application/octet-stream', size: blob.size };
  await writeFile(boardId, file.id, blob);
  return file;
}

/** Puts the card on the board, saves it and remembers the board and section; removes `files` again when saving fails. */
async function commit(boardId: string, card: LinkCard | ImageCard | NoteCard, sectionId: string | undefined, files: FileRef[]): Promise<SaveResult> {
  try {
    const board = await loadBoard(boardId);
    if (!board) throw new Error(`Board ${boardId} is gone.`);
    const next = placeCard(board, card, Date.now(), sectionId);
    await saveBoard(next);
    await saveSettings({ lastBoardId: boardId, lastSectionId: targetSection(board, sectionId).id });
    return { ok: true, board: next, card: next.cards[card.id]! };
  } catch (error) {
    await Promise.all(files.map((f) => deleteFile(boardId, f.id).catch(() => undefined)));
    return { ok: false, problem: 'failed', error };
  }
}

/** Reads the tab and saves it as a link card with its text and preview. */
export async function savePage(tab: TabInfo, boardId: string, sectionId?: string): Promise<SaveResult> {
  const read = await readPage(tab.id);
  if (!read.ok) return { ok: false, problem: 'cant-read', reason: read.problem };
  const space = await storageState();
  const blob = space.low ? undefined : await previewImage(tab, read.value.previewUrl);
  const preview = blob ? await storeFile(boardId, blob, 'preview.jpg') : undefined;
  const now = Date.now();
  const card = linkCard(newId(), now, { ...read.value, preview });
  const saved = await commit(boardId, card, sectionId, preview ? [preview] : []);
  const offline = !blob && !space.low && !navigator.onLine;
  if (saved.ok && offline && read.value.previewUrl) await rememberPreview({ boardId, cardId: card.id, tabId: tab.id, src: read.value.previewUrl });
  return saved.ok && offline ? { ...saved, offline } : saved;
}

/** Saves only the address and title, for pages Chrome does not let Briefkord read. */
export async function saveLinkOnly(page: { url: string; title: string }, boardId: string, sectionId?: string): Promise<SaveResult> {
  return commit(boardId, linkCard(newId(), Date.now(), { url: page.url, title: page.title, text: '', words: 0 }), sectionId, []);
}

/** Copies an image from the page (right-click) onto the board. */
export async function saveImage(tabId: number, src: string, page: { url?: string; title?: string }, boardId: string, sectionId?: string): Promise<SaveResult> {
  if ((await storageState()).low) return { ok: false, problem: 'storage-low' };
  const copied = await pageImage(tabId, src);
  if (!copied.ok) return { ok: false, problem: 'image-blocked' };
  const name = imageFileName(src, copied.value.mime);
  if (copied.value.bytes > MAX_FILE_BYTES) return { ok: false, problem: 'file-too-big', name, bytes: copied.value.bytes };
  const file = await storeFile(boardId, pageImageBlob(copied.value), name);
  const { alt, width, height } = copied.value;
  const card = imageCard(newId(), Date.now(), { file, title: alt ? titleFrom(alt) : page.title ?? name, pageUrl: page.url, width, height });
  return commit(boardId, card, sectionId, [file]);
}

export async function saveNote(text: string, boardId: string, sectionId?: string): Promise<SaveResult> {
  return commit(boardId, noteCard(newId(), Date.now(), text), sectionId, []);
}

/** Saves a right-clicked image or selection to a board. */
export async function saveCapture(capture: PendingCapture, boardId: string, sectionId?: string): Promise<SaveResult> {
  if (capture.kind === 'selection') {
    const source = capture.pageUrl ? { url: capture.pageUrl, title: capture.pageTitle ?? '' } : undefined;
    return commit(boardId, quoteCard(newId(), Date.now(), capture.text, source), sectionId, []);
  }
  return saveImage(capture.tabId, capture.src, { url: capture.pageUrl, title: capture.pageTitle }, boardId, sectionId);
}

/** Takes a just-added card off its board again ("Undo"), with its files. */
export async function removeCard(boardId: string, cardId: string): Promise<void> {
  const board = await loadBoard(boardId);
  const card = board?.cards[cardId];
  if (!board || !card) return;
  await saveBoard(deleteCards(board, [cardId], Date.now()));
  const files = card.kind === 'image' || card.kind === 'file' ? [card.file] : card.kind === 'link' && card.preview ? [card.preview] : [];
  await Promise.all(files.map((f) => deleteFile(boardId, f.id)));
}

interface PendingPreview { boardId: string; cardId: string; tabId: number; src: string }
const PENDING_KEY = 'pendingPreviews';

async function rememberPreview(pending: PendingPreview): Promise<void> {
  const stored = ((await browser.storage.local.get(PENDING_KEY))[PENDING_KEY] as PendingPreview[] | undefined) ?? [];
  await browser.storage.local.set({ [PENDING_KEY]: [...stored, pending].slice(-20) });
}

/** Back online: adds the preview images that could not be fetched while offline (StatesMore `offline-save`). */
export async function addMissingPreviews(): Promise<void> {
  const pending = ((await browser.storage.local.get(PENDING_KEY))[PENDING_KEY] as PendingPreview[] | undefined) ?? [];
  if (!pending.length) return;
  await browser.storage.local.remove(PENDING_KEY);
  for (const item of pending) {
    try {
      const copied = await pageImage(item.tabId, item.src);
      if (!copied.ok) continue;
      const board = await loadBoard(item.boardId);
      if (board?.cards[item.cardId]?.kind !== 'link') continue;
      const preview = await storeFile(item.boardId, await shrink(pageImageBlob(copied.value)), 'preview.jpg');
      const fresh = (await loadBoard(item.boardId)) ?? board;
      await saveBoard(updateCard(fresh, item.cardId, Date.now(), (c) => (c.kind === 'link' ? { ...c, preview, rect: { ...c.rect, h: Math.max(c.rect.h, 214) } } : c)));
    } catch (error) {
      console.error('Briefkord: could not add the preview image', error);
    }
  }
}
