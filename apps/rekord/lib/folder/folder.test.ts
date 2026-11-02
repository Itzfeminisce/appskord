import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Real handles clone into IndexedDB; the fake one holds functions, so it is kept in memory here.
vi.mock('@appskord/platform', async (original) => {
  const actual = await original<typeof import('@appskord/platform')>();
  let held: FileSystemDirectoryHandle | undefined;
  return { ...actual, folderHandle: () => ({ get: async () => held, put: async (h: FileSystemDirectoryHandle) => { held = h; }, clear: async () => { held = undefined; } }) };
});
import { closeDB, getDB } from '../db';
import { SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_ONE_ON_ONE, SAMPLE_ONE_ON_ONE_ITEMS, SAMPLE_PEOPLE, sampleSegments, seedSample } from '../memory/sample';
import { folderFiles, meetingMarkdown, meetingPath, personPath, safeName } from './markdown';
import { allowFolder, chooseFolder, flushFolder, folderStatus, stopFolder, useFolderDB, writeAll, writeFiles, type DirHandle } from './index';

/** An in-memory directory that records every file written. */
function fakeDir(files: Map<string, string>, permission: { value: 'granted' | 'prompt' }, prefix = ''): DirHandle {
  return {
    name: prefix ? prefix.split('/').at(-2)! : 'Rekord',
    queryPermission: async () => permission.value,
    requestPermission: async () => { permission.value = 'granted'; return 'granted'; },
    getDirectoryHandle: async (name) => fakeDir(files, permission, `${prefix}${name}/`),
    getFileHandle: async (name) => ({
      createWritable: async () => {
        let text = '';
        return { write: async (t: string) => { text += t; }, close: async () => { files.set(`${prefix}${name}`, text); } };
      },
    }),
  };
}

describe('Rekord folder Markdown', () => {
  const people = new Map(SAMPLE_PEOPLE.map((p) => [p.id, p]));

  it('names files in the documented layout', () => {
    expect(meetingPath(SAMPLE_ONE_ON_ONE)).toBe('Meetings/2026-11-03 1∶1 with Sarah.md');
    expect(personPath(SAMPLE_PEOPLE[0]!)).toBe('People/Sarah Chen.md');
    expect(safeName('a/b\\c?*"<>|')).toBe('a-b-c------');
    expect(safeName('  ')).toBe('Untitled');
  });

  it('writes a meeting with front matter, items with their quotes, and the transcript', () => {
    const items = SAMPLE_ONE_ON_ONE_ITEMS;
    const segments = sampleSegments(items).filter((s) => s.meetingId === SAMPLE_ONE_ON_ONE.id);
    const md = meetingMarkdown({ meeting: SAMPLE_ONE_ON_ONE, segments, notes: [{ id: 'n1', meetingId: SAMPLE_ONE_ON_ONE.id, atMs: 60_000, text: 'Ask about Q1', createdAt: 0 }], markers: [], items }, people);
    expect(md.startsWith('---\nid: "m-sarah-11-03"\ntitle: "1:1 with Sarah"\ndate: "2026-11-03"\nstart: "10:00"\nend: "10:32"\npeople: [')).toBe(true);
    expect(md).toContain('source: "rekord"\n---\n\n# 1:1 with Sarah\n');
    expect(md).toContain('## Notes\n\n- 01:00 Ask about Q1\n');
    expect(md).toContain('## Transcript\n');
    const promise = items.find((i) => i.kind === 'promise' && i.status !== 'suggested' && i.status !== 'dismissed' && !i.leftOut);
    if (promise) expect(md).toContain(`  > “${promise.quote.text}”`);
  });

  it('always writes people, Open loops and Decisions', () => {
    const files = folderFiles([], { meetings: SAMPLE_MEETINGS, people: SAMPLE_PEOPLE, items: SAMPLE_ITEMS });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('People/Sarah Chen.md');
    expect(paths).toContain('Open loops.md');
    expect(paths).toContain('Decisions.md');
    expect(files.find((f) => f.path === 'Decisions.md')!.text).toContain('# Decisions');
    expect(files.find((f) => f.path === 'Open loops.md')!.text).toContain('[[Meetings/');
  });
});

describe('Rekord folder writer', () => {
  const files = new Map<string, string>();
  const permission = { value: 'granted' as 'granted' | 'prompt' };

  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await useFolderDB('rekord-folder-test');
    await seedSample(await getDB());
    files.clear();
    permission.value = 'granted';
    (globalThis as unknown as { showDirectoryPicker: () => Promise<DirHandle> }).showDirectoryPicker = async () => fakeDir(files, permission);
  });

  it('writes nested paths', async () => {
    await writeFiles(fakeDir(files, permission), [{ path: 'Meetings/x.md', text: 'hi' }]);
    expect(files.get('Meetings/x.md')).toBe('hi');
  });

  it('chooses a folder, waits for "Write all", then writes every meeting', async () => {
    expect((await folderStatus()).state).toBe('off');
    expect(await chooseFolder()).toBe(true);
    expect(files.has('Open loops.md')).toBe(true);
    expect([...files.keys()].filter((p) => p.startsWith('Meetings/'))).toHaveLength(0);
    expect(await folderStatus()).toMatchObject({ state: 'on', name: 'Rekord', past: 24 });
    await writeAll();
    expect([...files.keys()].filter((p) => p.startsWith('Meetings/')).length).toBeGreaterThan(0);
    expect(await folderStatus()).toMatchObject({ past: 0 });
  });

  it('queues while permission is lost and flushes after "Allow"', async () => {
    await chooseFolder();
    permission.value = 'prompt';
    await (await getDB()).put('meetings', SAMPLE_ONE_ON_ONE);
    expect(await flushFolder()).toBe(false);
    expect((await folderStatus()).state).toBe('needsPermission');
    expect(await allowFolder()).toBe(true);
    expect(files.has(meetingPath(SAMPLE_ONE_ON_ONE))).toBe(true);
    await stopFolder();
    expect((await folderStatus()).state).toBe('off');
  });
});
