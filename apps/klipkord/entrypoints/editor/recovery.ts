import type { Project } from '@/lib/project/types';

/** Edits not yet in IndexedDB, kept in this browser so a crash or a full disk loses nothing (unsaved-recovered). */
export interface Unsaved { project: Project; changes: number; at: number }

/** The copy leaves out undo history; past this many characters it is not kept at all. */
export const UNSAVED_MAX_CHARS = 1_000_000;
let warned = false;

const key = (id: string) => `klipkord.unsaved.${id}`;

// Storage can be missing or full; recovery is a convenience, so every access is guarded.
export function readUnsaved(id: string): Unsaved | null {
  try {
    const raw = localStorage.getItem(key(id));
    const parsed = raw ? (JSON.parse(raw) as Unsaved) : null;
    if (!parsed || parsed.project?.id !== id || !(parsed.changes > 0)) return null;
    return { ...parsed, project: { ...parsed.project, history: {} } };
  } catch {
    return null;
  }
}

export function writeUnsaved(value: Unsaved): void {
  const { history: _history, ...project } = value.project;
  try {
    const raw = JSON.stringify({ ...value, project });
    if (raw.length > UNSAVED_MAX_CHARS) throw new Error(`the copy is ${raw.length} characters, over ${UNSAVED_MAX_CHARS}`);
    localStorage.setItem(key(value.project.id), raw);
  } catch (error) {
    // A stale copy would bring back older edits, so it goes too.
    clearUnsaved(value.project.id);
    if (!warned) console.error('Klipkord: could not keep unsaved edits', error);
    warned = true;
  }
}

export function clearUnsaved(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    // Nothing kept, nothing to clear.
  }
}
