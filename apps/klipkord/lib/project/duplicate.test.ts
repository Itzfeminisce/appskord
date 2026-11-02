import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import { duplicateProject, type DuplicateDeps } from './duplicate';
import type { Project } from './types';

const rec = { id: 'r1', title: 'Demo', share: { fileId: 'f', link: 'l', at: 1 }, bytes: 9 } as unknown as Recording;
const project = {
  id: 'r1', name: 'Demo', cuts: [{ id: 'c1' }, { id: 'c2' }], current: 'c1',
  history: { c1: { undo: [{ label: 'Cut 3 words', before: {}, at: 1 }], redo: [] } },
} as unknown as Project;

function fakes(fail?: 'project') {
  const recordings = new Map<string, Recording>([['r1', rec]]);
  const files = new Map<string, string>([['r1', 'bytes']]);
  const projects = new Map<string, Project>();
  const deps: DuplicateDeps = {
    getRecording: async (id) => recordings.get(id),
    putRecording: async (r) => { recordings.set(r.id, r); },
    deleteRecording: async (id) => { recordings.delete(id); },
    copyFiles: async (from, to) => { files.set(to, files.get(from)!); },
    removeFiles: async (id) => { files.delete(id); },
    saveProject: async (p) => { if (fail) throw new Error('disk full'); projects.set(p.id, p); },
    newId: () => 'r2',
  };
  return { deps, recordings, files, projects };
}

describe('duplicateProject', () => {
  it('copies the recording, its files and the project under a new id with history cleared', async () => {
    const { deps, recordings, files, projects } = fakes();
    expect(await duplicateProject(project, deps)).toBe('r2');
    expect(recordings.get('r2')).toMatchObject({ id: 'r2', title: 'Demo copy', bytes: 9 });
    expect(recordings.get('r2')!.share).toBeUndefined();
    expect(files.get('r2')).toBe('bytes');
    const copy = projects.get('r2')!;
    expect(copy).toMatchObject({ id: 'r2', name: 'Demo copy', current: 'c1' });
    expect(copy.history).toEqual({ c1: { undo: [], redo: [] }, c2: { undo: [], redo: [] } });
    expect(project.history.c1!.undo).toHaveLength(1);
    expect(recordings.get('r1')!.title).toBe('Demo');
  });

  it('leaves nothing behind when a step fails', async () => {
    const { deps, recordings, files } = fakes('project');
    await expect(duplicateProject(project, deps)).rejects.toThrow('disk full');
    expect(recordings.has('r2')).toBe(false);
    expect(files.has('r2')).toBe(false);
  });
});
