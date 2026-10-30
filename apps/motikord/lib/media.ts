// Asset files live in OPFS under their opfsPath ("media/<id>.<ext>"); the recipe keeps only the path.

type Root = () => Promise<FileSystemDirectoryHandle>;
const opfs: Root = () => navigator.storage.getDirectory();

/** A fresh OPFS path for a new asset, keyed by its id. */
export function mediaPath(id: string, ext: string): string {
  const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return clean ? `media/${id}.${clean}` : `media/${id}`;
}

function split(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) throw new Error(`Bad media path "${path}"`);
  return { dirs: parts.slice(0, -1), name: parts[parts.length - 1]! };
}

async function dirOf(root: FileSystemDirectoryHandle, dirs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const d of dirs) dir = await dir.getDirectoryHandle(d, { create });
  return dir;
}

const notFound = (error: unknown) => (error as { name?: string }).name === 'NotFoundError';

/** Writes the file at `path`, replacing any file already there. */
export async function putMedia(path: string, data: Blob, root: Root = opfs): Promise<void> {
  const { dirs, name } = split(path);
  const file = await (await dirOf(await root(), dirs, true)).getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await data.stream().pipeTo(writable);
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

/** The file at `path`, or undefined when it is not there. */
export async function getMedia(path: string, root: Root = opfs): Promise<File | undefined> {
  const { dirs, name } = split(path);
  try {
    return await (await (await dirOf(await root(), dirs, false)).getFileHandle(name)).getFile();
  } catch (error) {
    if (notFound(error)) return undefined;
    throw error;
  }
}

/** Deletes the file at `path`; a missing file is not an error. */
export async function deleteMedia(path: string, root: Root = opfs): Promise<void> {
  const { dirs, name } = split(path);
  try {
    await (await dirOf(await root(), dirs, false)).removeEntry(name);
  } catch (error) {
    if (!notFound(error)) throw error;
  }
}

/** Bytes of the file at `path`, or 0 when it is not there. */
export async function mediaSize(path: string, root: Root = opfs): Promise<number> {
  return (await getMedia(path, root))?.size ?? 0;
}
