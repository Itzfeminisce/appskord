import { describe, expect, it } from 'vitest';
import { deleteMedia, getMedia, mediaPath, mediaSize, putMedia } from './media';

// A tiny in-memory stand-in for OPFS directory and file handles.
function fakeDir(): FileSystemDirectoryHandle {
  const dirs = new Map<string, FileSystemDirectoryHandle>();
  const files = new Map<string, Blob>();
  const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
  return {
    async getDirectoryHandle(name: string, o?: { create?: boolean }) {
      if (!dirs.has(name)) { if (!o?.create) throw notFound(); dirs.set(name, fakeDir()); }
      return dirs.get(name)!;
    },
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!files.has(name)) { if (!o?.create) throw notFound(); files.set(name, new Blob()); }
      return {
        getFile: async () => new File([files.get(name)!], name),
        createWritable: async () => {
          const parts: BlobPart[] = [];
          return new WritableStream({ write: (c) => { parts.push(c); }, close: () => { files.set(name, new Blob(parts)); } });
        },
      };
    },
    async removeEntry(name: string) {
      if (!files.delete(name)) throw notFound();
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('media', () => {
  it('makes safe paths', () => {
    expect(mediaPath('abc', '.JPG')).toBe('media/abc.jpg');
    expect(mediaPath('abc', '')).toBe('media/abc');
  });

  it('puts, gets, sizes and deletes a file', async () => {
    const root = fakeDir();
    const r = async () => root;
    await putMedia('media/a.txt', new Blob(['hello']), r);
    expect(await (await getMedia('media/a.txt', r))!.text()).toBe('hello');
    expect(await mediaSize('media/a.txt', r)).toBe(5);
    await deleteMedia('media/a.txt', r);
    expect(await getMedia('media/a.txt', r)).toBeUndefined();
    expect(await mediaSize('media/a.txt', r)).toBe(0);
    await deleteMedia('media/a.txt', r); // missing is fine
  });

  it('rejects paths that climb out', async () => {
    await expect(getMedia('../x', async () => fakeDir())).rejects.toThrow(/Bad media path/);
  });
});
