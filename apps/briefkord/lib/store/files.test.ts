import { describe, expect, it } from 'vitest';
import { deleteBoardFiles, deleteFile, MAX_FILE_BYTES, readFile, refuseFile, writeFile } from './files';

const notFound = () => new DOMException('missing', 'NotFoundError');

/** An in-memory stand-in for an OPFS directory. */
class FakeDir {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, Blob>();
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    if (!this.dirs.has(name)) {
      if (!opts?.create) throw notFound();
      this.dirs.set(name, new FakeDir());
    }
    return this.dirs.get(name)!;
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name) && !opts?.create) throw notFound();
    return {
      getFile: async () => new File([this.files.get(name)!], name),
      createWritable: async () => {
        const parts: Blob[] = [];
        return { write: async (b: Blob) => void parts.push(b), close: async () => void this.files.set(name, new Blob(parts)) };
      },
    };
  }
  async removeEntry(name: string) {
    if (!this.dirs.delete(name) && !this.files.delete(name)) throw notFound();
  }
}

const rootOf = () => {
  const dir = new FakeDir();
  return { dir, root: async () => dir as unknown as FileSystemDirectoryHandle };
};

describe('card files', () => {
  it('writes, reads and deletes a file under boards/<boardId>/<fileId>', async () => {
    const { dir, root } = rootOf();
    await writeFile('b1', 'f1', new Blob(['fake image bytes']), root);
    expect(dir.dirs.get('boards')?.dirs.get('b1')?.files.has('f1')).toBe(true);
    expect(await (await readFile('b1', 'f1', root))?.text()).toBe('fake image bytes');
    await deleteFile('b1', 'f1', root);
    expect(await readFile('b1', 'f1', root)).toBeUndefined();
    await expect(deleteFile('b1', 'f1', root)).resolves.toBeUndefined();
  });

  it('removes a whole board folder, and is quiet when there is none', async () => {
    const { dir, root } = rootOf();
    await expect(deleteBoardFiles('b1', root)).resolves.toBeUndefined();
    await writeFile('b1', 'f1', new Blob(['x']), root);
    await writeFile('b2', 'f1', new Blob(['y']), root);
    await deleteBoardFiles('b1', root);
    expect([...dir.dirs.get('boards')!.dirs.keys()]).toEqual(['b2']);
    expect(await readFile('b1', 'f1', root)).toBeUndefined();
  });

  it('refuses videos and files over 50 MB', () => {
    expect(refuseFile({ type: 'video/mp4', size: 10 })).toBe('video');
    expect(refuseFile({ type: 'application/pdf', size: MAX_FILE_BYTES + 1 })).toBe('too-big');
    expect(refuseFile({ type: 'image/png', size: MAX_FILE_BYTES })).toBeNull();
  });
});
