import { describe, expect, it } from 'vitest';
import { ROLL_MS, createVideoStore } from './videoStore';

const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });

// Minimal in-memory OPFS: directories, files, keepExistingData writables.
class FakeFile {
  kind = 'file' as const;
  data = new Blob([]);
  writables = 0;
  async getFile() { return this.data; }
  async createWritable({ keepExistingData = false } = {}) {
    this.writables++;
    let buf = new Uint8Array(keepExistingData ? await this.data.arrayBuffer() : new ArrayBuffer(0));
    let pos = 0;
    return {
      seek: async (p: number) => { pos = p; },
      write: async (chunk: Blob | Uint8Array) => {
        const bytes = chunk instanceof Blob ? new Uint8Array(await chunk.arrayBuffer()) : chunk;
        const next = new Uint8Array(Math.max(buf.length, pos + bytes.length));
        next.set(buf);
        next.set(bytes, pos);
        buf = next;
        pos += bytes.length;
      },
      close: async () => { this.data = new Blob([buf]); },
      abort: async () => undefined,
    };
  }
}
class FakeDir {
  kind = 'directory' as const;
  items = new Map<string, FakeDir | FakeFile>();
  async *entries() {
    yield* this.items;
  }
  async getDirectoryHandle(name: string, { create = false } = {}) {
    let e = this.items.get(name);
    if (!e && create) this.items.set(name, (e = new FakeDir()));
    if (!(e instanceof FakeDir)) throw notFound();
    return e;
  }
  async getFileHandle(name: string, { create = false } = {}) {
    let e = this.items.get(name);
    if (!e && create) this.items.set(name, (e = new FakeFile()));
    if (!(e instanceof FakeFile)) throw notFound();
    return e;
  }
  async removeEntry(name: string) {
    if (!this.items.delete(name)) throw notFound();
  }
}

function setup() {
  const root = new FakeDir();
  const clock = { now: 0 };
  const store = createVideoStore({
    root: async () => root as unknown as FileSystemDirectoryHandle,
    estimate: async () => ({ usage: 1234, quota: 99_999 }),
    now: () => clock.now,
  });
  return { root, store, clock };
}

describe('videoStore', () => {
  it('appends chunks in order and reads them back as one Blob', async () => {
    const { store } = setup();
    await store.open('r1');
    await Promise.all([
      store.append('r1', 'video', new Blob(['ab'])),
      store.append('r1', 'video', new Blob(['cd'])),
      store.append('r1', 'voice', new Blob(['xyz'])),
    ]);
    await store.append('r1', 'video', new Blob(['e']));
    await store.close('r1');
    const video = await store.read('r1', 'video', 'video/mp4');
    expect(await video.text()).toBe('abcde');
    expect(video.type).toBe('video/mp4');
    expect(await (await store.read('r1', 'voice')).text()).toBe('xyz');
    expect(await store.size('r1')).toBe(8);
  });

  it('keeps one writable per segment, commits it after ROLL_MS and on close', async () => {
    const { store, root, clock } = setup();
    for (let i = 0; i < 5; i++) await store.append('r3', 'video', new Blob([String(i)]));
    // Nothing is committed while the first segment is open.
    expect((await store.read('r3', 'video')).size).toBe(0);
    clock.now = ROLL_MS;
    await store.append('r3', 'video', new Blob(['5']));
    expect(await (await store.read('r3', 'video')).text()).toBe('01234');
    await store.close('r3');
    expect(await (await store.read('r3', 'video')).text()).toBe('012345');
    const folder = await (await root.getDirectoryHandle('recordings')).getDirectoryHandle('r3');
    const segments = [...folder.items.values()] as FakeFile[];
    expect(segments.map((f) => f.writables)).toEqual([1, 1]);
    await store.append('r3', 'video', new Blob(['6']));
    await store.close('r3');
    expect(await (await store.read('r3', 'video')).text()).toBe('0123456');
  });

  it('reads the single-file layout of earlier builds first', async () => {
    const { store, root } = setup();
    const folder = await (await root.getDirectoryHandle('recordings', { create: true })).getDirectoryHandle('old', { create: true });
    (await folder.getFileHandle('voice', { create: true })).data = new Blob(['legacy']);
    expect(await (await store.read('old', 'voice')).text()).toBe('legacy');
  });

  it('reads every segment on disk in number order, past a gap', async () => {
    const { store, root } = setup();
    const folder = await (await root.getDirectoryHandle('recordings', { create: true })).getDirectoryHandle('gap', { create: true });
    for (const [name, text] of [['screen.10', 'c'], ['screen.0', 'a'], ['screen.2', 'b'], ['screen.x', 'no'], ['screenshot.1', 'no']]) {
      (await folder.getFileHandle(name!, { create: true })).data = new Blob([text!]);
    }
    expect(await (await store.read('gap', 'screen')).text()).toBe('abc');
    expect(await store.size('gap')).toBe(3);
  });

  it('does not use up a segment number when opening the file fails, and starts a new one after a failed write', async () => {
    const { store, root } = setup();
    await store.open('r5');
    const folder = await (await root.getDirectoryHandle('recordings')).getDirectoryHandle('r5');
    const getFileHandle = folder.getFileHandle.bind(folder);
    let failOpen = true;
    folder.getFileHandle = async (name, o) => {
      if (failOpen) { failOpen = false; throw new Error('disk'); }
      return getFileHandle(name, o);
    };
    await expect(store.append('r5', 'screen', new Blob(['x']))).rejects.toThrow('disk');
    await store.append('r5', 'screen', new Blob(['a']));
    expect(folder.items.has('screen.0')).toBe(true);
    await store.close('r5');
    // The next write breaks its writable; the chunk after it lands in a new segment.
    const original = FakeFile.prototype.createWritable;
    let broken = true;
    FakeFile.prototype.createWritable = async function (this: FakeFile, o) {
      const w = await original.call(this, o);
      if (broken) { broken = false; return { ...w, write: async () => { throw new Error('write'); } }; }
      return w;
    };
    try {
      await expect(store.append('r5', 'screen', new Blob(['lost']))).rejects.toThrow('write');
      await store.append('r5', 'screen', new Blob(['b']));
      await store.close('r5');
    } finally {
      FakeFile.prototype.createWritable = original;
    }
    expect(await (await store.read('r5', 'screen')).text()).toBe('ab');
  });

  it('reads an empty Blob and size 0 for a missing recording', async () => {
    const { store } = setup();
    expect((await store.read('none', 'video')).size).toBe(0);
    expect(await store.size('none')).toBe(0);
  });

  it('removes a recording, and removing twice is fine', async () => {
    const { store, root } = setup();
    await store.append('r2', 'video', new Blob(['data']));
    await store.close('r2');
    await store.append('r2', 'video', new Blob(['open']));
    await store.remove('r2');
    await store.remove('r2');
    expect((await root.getDirectoryHandle('recordings')).items.has('r2')).toBe(false);
    expect(await store.size('r2')).toBe(0);
  });

  it('keeps each v3 source in its own file, writes events.json and counts every track', async () => {
    const { store, root } = setup();
    await store.open('r4');
    await store.append('r4', 'screen', new Blob(['scr']));
    await store.append('r4', 'camera', new Blob(['cam']));
    await store.append('r4', 'voice', new Blob(['mic']));
    await store.append('r4', 'tab', new Blob(['tb']));
    await store.put('r4', 'events.json', new Blob(['{}']));
    await store.close('r4');
    expect(await (await store.read('r4', 'camera')).text()).toBe('cam');
    expect(await (await store.read('r4', 'tab')).text()).toBe('tb');
    // Screens that still play 'video' get the screen track of a v3 recording.
    expect(await (await store.read('r4', 'video')).text()).toBe('scr');
    expect(await store.size('r4')).toBe(11);
    const dir = await (await root.getDirectoryHandle('recordings')).getDirectoryHandle('r4');
    expect(await (await (await dir.getFileHandle('events.json')).getFile()).text()).toBe('{}');
  });

  it('reports storage usage', async () => {
    expect(await setup().store.usage()).toEqual({ usage: 1234, quota: 99_999 });
  });

  it('copies every file of a recording to a new id and leaves the first one as it was', async () => {
    const { store } = setup();
    await store.append('r1', 'screen', new Blob(['scr']));
    await store.append('r1', 'voice', new Blob(['mic']));
    await store.close('r1');
    await store.put('r1', 'events.json', new Blob(['{}']));
    await store.copy('r1', 'r1c');
    expect(await (await store.read('r1c', 'screen')).text()).toBe('scr');
    expect(await (await store.read('r1c', 'voice')).text()).toBe('mic');
    expect(await store.size('r1c')).toBe(await store.size('r1'));
    await store.remove('r1c');
    expect(await (await store.read('r1', 'screen')).text()).toBe('scr');
  });
});
