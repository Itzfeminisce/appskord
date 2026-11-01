// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/lib/project/types';
import { readUnsaved, UNSAVED_MAX_CHARS, writeUnsaved } from './recovery';

const project = (over: Partial<Project> = {}) => ({ id: 'rec-1', history: { full: { undo: [{}], redo: [] } }, ...over }) as unknown as Project;

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('unsaved edits copy', () => {
  it('keeps the project without its undo history', () => {
    writeUnsaved({ project: project(), changes: 2, at: 5 });
    expect(localStorage.getItem('klipkord.unsaved.rec-1')).not.toContain('undo');
    expect(readUnsaved('rec-1')?.project.history).toEqual({});
  });

  it('drops the copy quietly when it is too big or storage is full, logging once', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    writeUnsaved({ project: project(), changes: 1, at: 1 });
    writeUnsaved({ project: project({ name: 'x'.repeat(UNSAVED_MAX_CHARS) }), changes: 2, at: 2 });
    expect(readUnsaved('rec-1')).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    writeUnsaved({ project: project(), changes: 3, at: 3 });
    expect(log).toHaveBeenCalledTimes(1);
  });
});
