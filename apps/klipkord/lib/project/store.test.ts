import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, deleteRecording, putRecording } from '../db';
import type { Recording } from '../types';
import { fromRecording } from './migrate';
import { deleteProject, flushProjects, getProject, isSaving, putProject, SAVE_DEBOUNCE_MS } from './store';

const rec: Recording = {
  id: 'r', title: 'Demo', createdAt: 1, duration: 1000, status: 'ready', mode: 'tab', quality: '1080p', mime: 'video/mp4', bytes: 1,
  markers: [], notes: [], comments: [], transcript: [], transcriptPending: false, edits: [],
};

describe('project store', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
  });
  afterEach(() => vi.useRealTimers());

  it('writes only the newest version, 500 ms after the last edit', async () => {
    await putRecording(rec);
    vi.useFakeTimers();
    const p = fromRecording(rec);
    const first = putProject({ ...p, name: 'One' });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    const second = putProject({ ...p, name: 'Two' });
    expect(isSaving('r')).toBe(true);
    expect((await getProject('r'))?.name).toBe('Two');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100);
    expect(isSaving('r')).toBe(true);
    vi.useRealTimers();
    await flushProjects();
    await Promise.all([first, second]);
    expect(isSaving('r')).toBe(false);
    expect((await getProject('r'))?.name).toBe('Two');
  });

  it('saves after the debounce and deletes with the recording', async () => {
    await putRecording(rec);
    await putProject(fromRecording(rec));
    expect((await getProject('r'))?.version).toBe(3);
    await deleteRecording('r');
    expect(await getProject('r')).toBeUndefined();
  });

  it('never writes a waiting save after its recording is deleted', async () => {
    await putRecording(rec);
    const saved = putProject(fromRecording(rec));
    await deleteRecording('r');
    await flushProjects();
    await saved;
    expect(await getProject('r')).toBeUndefined();
  });

  it('deletes a project and drops its waiting save', async () => {
    const saved = putProject(fromRecording(rec));
    await deleteProject('r');
    await saved;
    await flushProjects();
    expect(await getProject('r')).toBeUndefined();
  });
});
