import type { Recording } from '../types';
import type { Project } from './types';

export interface DuplicateDeps {
  getRecording(id: string): Promise<Recording | undefined>;
  putRecording(r: Recording): Promise<void>;
  deleteRecording(id: string): Promise<void>;
  copyFiles(from: string, to: string): Promise<void>;
  removeFiles(id: string): Promise<void>;
  /** Writes the project now; the recording row must already exist. */
  saveProject(p: Project): Promise<void>;
  newId(): string;
}

/** The copy keeps every cut and edit but starts with an empty Undo history. */
export function copyProject(project: Project, id: string): Project {
  const history = Object.fromEntries(project.cuts.map((c) => [c.id, { undo: [], redo: [] }]));
  return { ...structuredClone(project), id, name: `${project.name} copy`, history };
}

/** Duplicate project: a new recording row, its files and the project under a new id. Returns the new id. */
export async function duplicateProject(project: Project, deps: DuplicateDeps): Promise<string> {
  const rec = await deps.getRecording(project.id);
  if (!rec) throw new Error('Klipkord: the recording to duplicate is gone');
  const id = deps.newId();
  // The Drive link and the saved folder belong to the first recording.
  const { share: _share, savedTo: _savedTo, ...rest } = rec;
  try {
    await deps.copyFiles(project.id, id);
    await deps.putRecording({ ...rest, id, title: `${rec.title} copy` });
    await deps.saveProject(copyProject(project, id));
  } catch (error) {
    await Promise.allSettled([deps.removeFiles(id), deps.deleteRecording(id)]);
    throw error;
  }
  return id;
}
