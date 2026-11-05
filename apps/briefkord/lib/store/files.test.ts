import { describe, expect, it } from 'vitest';
import { copyFiles, deleteBoardFiles, deleteFile, MAX_FILE_BYTES, readFile, refuseFile, servedType, sweepUnusedFiles, writeFile } from './files';

const notFound = () => new DOMException('missing', 'NotFoundError');

/** An in-memory stand-in for an OPFS directory. */
class FakeDir {
  dirs = new Map<string, FakeDir>();
  files = new Map<string, Blob>();
  times = new Map<string, number>();
  async *entries() {
    for (const [name, dir] of this.dirs) yield [name, { kind: 'directory', ...dir }] as const;
    for (const name of this.files.keys()) yield [name, { kind: 'file', getFile: async () => new File([this.files.get(name)!], name, { lastModified: this.times.get(name) ?? 0 }) }] as const;
  }
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

const ref = { id: 'f1', mime: 'image/svg+xml' };

describe('card files', () => {
  it('writes, reads and deletes a file under boards/<boardId>/<fileId>', async () => {
    const { dir, root } = rootOf();
    await writeFile('b1', 'f1', new Blob(['fake image bytes']), root);
    expect(dir.dirs.get('boards')?.dirs.get('b1')?.files.has('f1')).toBe(true);
    expect(await (await readFile('b1', ref, root))?.text()).toBe('fake image bytes');
    await deleteFile('b1', 'f1', root);
    expect(await readFile('b1', ref, root)).toBeUndefined();
    await expect(deleteFile('b1', 'f1', root)).resolves.toBeUndefined();
  });

  it('removes a whole board folder, and is quiet when there is none', async () => {
    const { dir, root } = rootOf();
    await expect(deleteBoardFiles('b1', root)).resolves.toBeUndefined();
    await writeFile('b1', 'f1', new Blob(['x']), root);
    await writeFile('b2', 'f1', new Blob(['y']), root);
    await deleteBoardFiles('b1', root);
    expect([...dir.dirs.get('boards')!.dirs.keys()]).toEqual(['b2']);
    expect(await readFile('b1', ref, root)).toBeUndefined();
  });

  it('reads bytes with the type the card names, never as a page', async () => {
    const { root } = rootOf();
    await writeFile('b1', 'f1', new Blob(['<svg/>']), root);
    expect((await readFile('b1', ref, root))!.type).toBe('image/svg+xml');
    expect(servedType('text/html; charset=utf-8')).toBe('text/plain');
    expect(servedType('application/pdf')).toBe('application/pdf');
  });

  it('copies files to another board under new ids', async () => {
    const { root } = rootOf();
    await writeFile('b1', 'f1', new Blob(['fake bytes']), root);
    await copyFiles('b1', 'b2', [{ id: 'f1', name: 'a.png', mime: 'image/png', size: 10 }, { id: 'gone', name: 'b', mime: 'x/y', size: 1 }], (id) => `${id}-copy`, root);
    expect(await (await readFile('b2', { id: 'f1-copy', mime: 'image/png' }, root))?.text()).toBe('fake bytes');
    expect(await readFile('b1', ref, root)).toBeDefined();
  });

  it('sweeps files no card uses, keeping recent ones', async () => {
    const { dir, root } = rootOf();
    for (const id of ['used', 'old', 'new']) await writeFile('b1', id, new Blob([id]), root);
    const folder = dir.dirs.get('boards')!.dirs.get('b1')!;
    folder.times.set('new', 10 * 60_000);
    await sweepUnusedFiles('b1', new Set(['used']), 11 * 60_000, root);
    expect([...folder.files.keys()].sort()).toEqual(['new', 'used']);
    await expect(sweepUnusedFiles('none', new Set(), 0, root)).resolves.toBeUndefined();
  });

  it('refuses videos and files over 50 MB', () => {
    expect(refuseFile({ type: 'video/mp4', size: 10 })).toBe('video');
    expect(refuseFile({ type: 'application/pdf', size: MAX_FILE_BYTES + 1 })).toBe('too-big');
    expect(refuseFile({ type: 'image/png', size: MAX_FILE_BYTES })).toBeNull();
  });
});
