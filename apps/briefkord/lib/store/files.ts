/** Card files (images, documents, page previews) in OPFS at `boards/<boardId>/<fileId>`. */
import type { FileRef } from '../board/types';

/** The biggest file a card may hold. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** A file written this recently may belong to a save still in progress. */
const FRESH_MS = 5 * 60_000;

export type FileRefusal = 'too-big' | 'video';

/** Why a dropped or picked file is refused, or null when it may be added. */
export function refuseFile(file: { type: string; size: number }): FileRefusal | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.size > MAX_FILE_BYTES) return 'too-big';
  return null;
}

type Root = () => Promise<FileSystemDirectoryHandle>;

const opfs: Root = () => navigator.storage.getDirectory();

const isNotFound = (error: unknown): boolean => error instanceof DOMException && error.name === 'NotFoundError';

async function boardDir(boardId: string, create: boolean, root: Root): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const boards = await (await root()).getDirectoryHandle('boards', { create });
    return await boards.getDirectoryHandle(boardId, { create });
  } catch (error) {
    if (!create && isNotFound(error)) return undefined;
    throw error;
  }
}

export async function writeFile(boardId: string, fileId: string, data: Blob, root: Root = opfs): Promise<void> {
  const dir = await boardDir(boardId, true, root);
  const writable = await (await dir!.getFileHandle(fileId, { create: true })).createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

/** The type a stored file is served with; pages are served as text so they never run in the extension. */
export function servedType(mime: string): string {
  const type = mime.toLowerCase().split(';')[0]!.trim();
  return type === 'text/html' || type === 'application/xhtml+xml' || type === 'text/xml' || type === 'application/xml' ? 'text/plain' : type;
}

/** The file's bytes typed with its `mime` (OPFS keeps no type), or undefined when it is not stored. */
export async function readFile(boardId: string, ref: Pick<FileRef, 'id' | 'mime'>, root: Root = opfs): Promise<Blob | undefined> {
  const dir = await boardDir(boardId, false, root);
  if (!dir) return undefined;
  try {
    const file = await (await dir.getFileHandle(ref.id)).getFile();
    return new Blob([file], { type: servedType(ref.mime) });
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

/** Copies stored files from one board's folder to another's, under the ids `to` gives them; missing files are skipped. */
export async function copyFiles(fromBoard: string, toBoard: string, files: readonly FileRef[], to: (id: string) => string = (id) => id, root: Root = opfs): Promise<void> {
  for (const ref of files) {
    const blob = await readFile(fromBoard, ref, root);
    if (blob) await writeFile(toBoard, to(ref.id), blob, root);
  }
}

/** Files in a board's folder that no card uses, kept when written lately since a save may be about to use them. */
export async function sweepUnusedFiles(boardId: string, used: ReadonlySet<string>, now = Date.now(), root: Root = opfs): Promise<void> {
  const dir = await boardDir(boardId, false, root);
  if (!dir) return;
  const unused: string[] = [];
  for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'file' || used.has(name)) continue;
    if (now - (await (handle as FileSystemFileHandle).getFile()).lastModified >= FRESH_MS) unused.push(name);
  }
  for (const name of unused) await deleteFile(boardId, name, root);
}

export async function deleteFile(boardId: string, fileId: string, root: Root = opfs): Promise<void> {
  const dir = await boardDir(boardId, false, root);
  try {
    await dir?.removeEntry(fileId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Removes a board's folder and every file in it. */
export async function deleteBoardFiles(boardId: string, root: Root = opfs): Promise<void> {
  try {
    const boards = await (await root()).getDirectoryHandle('boards');
    await boards.removeEntry(boardId, { recursive: true });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}
