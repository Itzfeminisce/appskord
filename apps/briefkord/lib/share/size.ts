/** How big a shared file will be before it is made, and which files to leave out of a view file that is too big. Pure. */
import type { Board } from '../board/types';
import { boardFiles } from './prepare';

/** A view file over this is `export-too-big`. */
export const VIEW_FILE_LIMIT = 50 * 1024 * 1024;

const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;
// base64 plus "data:<mime>;base64," and the JSON quoting around it.
const dataUriBytes = (size: number, mime: string): number => Math.ceil(size / 3) * 4 + mime.length + 20;

/** The view file's size: page, renderer, styles, board JSON and every file not left out as a data URI. */
export function estimateViewBytes(board: Board, pageBytes: number, leaveOut: ReadonlySet<string> = new Set()): number {
  const files = boardFiles(board).filter((f) => !leaveOut.has(f.id));
  return pageBytes + jsonBytes(board) + files.reduce((sum, f) => sum + dataUriBytes(f.size, f.mime), 0);
}

/** The edit file's size: board JSON and files, stored as they are (images are already compressed). */
export function estimateEditBytes(board: Board): number {
  const files = boardFiles(board);
  return jsonBytes(board) + 200 + files.reduce((sum, f) => sum + f.size + 100 + f.id.length * 2, 0);
}

/** The fewest files, largest first, to leave out so the view file fits under `limit`. Empty when it already fits. */
export function filesToLeaveOut(board: Board, pageBytes: number, limit = VIEW_FILE_LIMIT): string[] {
  const out = new Set<string>();
  const largest = boardFiles(board).sort((a, b) => b.size - a.size);
  for (const file of largest) {
    if (estimateViewBytes(board, pageBytes, out) <= limit) break;
    out.add(file.id);
  }
  return [...out];
}
