import type { Project } from '@/lib/project/types';

/** Edits not yet in IndexedDB, kept in this browser so a crash or a full disk loses nothing (unsaved-recovered). */
export interface Unsaved { project: Project; changes: number; at: number }

const key = (id: string) => `klipkord.unsaved.${id}`;

// Storage can be missing or full; recovery is a convenience, so every access is guarded.
export function readUnsaved(id: string): Unsaved | null {
  try {
    const raw = localStorage.getItem(key(id));
    const parsed = raw ? (JSON.parse(raw) as Unsaved) : null;
    return parsed && parsed.project?.id === id && parsed.changes > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeUnsaved(value: Unsaved): void {
  try {
    localStorage.setItem(key(value.project.id), JSON.stringify(value));
  } catch (error) {
    console.error('Klipkord: could not keep unsaved edits', error);
  }
}

export function clearUnsaved(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    // Nothing kept, nothing to clear.
  }
}
