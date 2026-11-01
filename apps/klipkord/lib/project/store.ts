import { getDB } from '../db';
import type { Project } from './types';

/** Edits land in IndexedDB this long after the last one. */
export const SAVE_DEBOUNCE_MS = 500;

interface Pending { project: Project; timer: ReturnType<typeof setTimeout>; waiters: { resolve: () => void; reject: (e: unknown) => void }[] }
const pending = new Map<string, Pending>();

export async function getProject(id: string): Promise<Project | undefined> {
  const queued = pending.get(id);
  if (queued) return queued.project;
  return (await getDB()).get('projects', id);
}

async function write(id: string): Promise<void> {
  const job = pending.get(id);
  if (!job) return;
  pending.delete(id);
  clearTimeout(job.timer);
  try {
    // One transaction with the recording, so a save that lands after deleteRecording never leaves an orphan project.
    const tx = (await getDB()).transaction(['recordings', 'projects'], 'readwrite');
    if (await tx.objectStore('recordings').getKey(id)) await tx.objectStore('projects').put({ ...job.project, updatedAt: Date.now() });
    await tx.done;
    job.waiters.forEach((w) => w.resolve());
  } catch (error) {
    job.waiters.forEach((w) => w.reject(error));
  }
}

/**
 * Saves a project 500 ms after the last call for it; only the newest version is written.
 * Resolves once that write lands, and rejects when it fails (the top bar's "Not saved").
 */
export function putProject(project: Project): Promise<void> {
  return new Promise((resolve, reject) => {
    const job = pending.get(project.id);
    if (job) clearTimeout(job.timer);
    const waiters = [...(job?.waiters ?? []), { resolve, reject }];
    pending.set(project.id, { project, waiters, timer: setTimeout(() => void write(project.id), SAVE_DEBOUNCE_MS) });
  });
}

/** True while a save for this project is waiting to be written ("Saving…"). */
export const isSaving = (id: string): boolean => pending.has(id);

/** Writes every waiting save now, e.g. before the page closes. */
export async function flushProjects(): Promise<void> {
  await Promise.all([...pending.keys()].map(write));
}

/** Deletes the project and drops its waiting save; deleteRecording in lib/db.ts removes it with its recording. */
export async function deleteProject(id: string): Promise<void> {
  const job = pending.get(id);
  if (job) {
    clearTimeout(job.timer);
    pending.delete(id);
    job.waiters.forEach((w) => w.resolve());
  }
  await (await getDB()).delete('projects', id);
}
