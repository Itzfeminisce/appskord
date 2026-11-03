/** Card files (images, documents, page previews) in OPFS at `boards/<boardId>/<fileId>`. */

/** The biggest file a card may hold. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

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

/** The file's bytes, or undefined when it is not stored. */
export async function readFile(boardId: string, fileId: string, root: Root = opfs): Promise<File | undefined> {
  const dir = await boardDir(boardId, false, root);
  if (!dir) return undefined;
  try {
    return await (await dir.getFileHandle(fileId)).getFile();
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
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
