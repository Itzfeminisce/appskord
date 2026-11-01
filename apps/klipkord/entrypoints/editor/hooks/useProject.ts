import { useCallback, useEffect, useRef, useState } from 'react';
import { getRecording } from '@/lib/db';
import { canRedo, canUndo, commit, redo as redoStep, undo as undoStep } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { flushProjects, getProject, putProject } from '@/lib/project/store';
import type { Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import { clearUnsaved, readUnsaved, writeUnsaved, type Unsaved } from '../recovery';

/** The top bar's save status: "Opening…", "Saving…", "Saved", "Not saved". */
export type SaveStatus = 'opening' | 'saving' | 'saved' | 'not-saved';

/** How often a pending transcript is checked for. */
export const TRANSCRIPT_POLL_MS = 3000;

export const SAVE_LABEL: Record<SaveStatus, string> = { opening: 'Opening…', saving: 'Saving…', saved: 'Saved', 'not-saved': 'Not saved' };

export interface ProjectApi {
  phase: 'loading' | 'ready' | 'missing';
  recording?: Recording;
  project?: Project;
  save: SaveStatus;
  /** Runs one pure op from lib/project on the project and saves it. Ignored while read-only. */
  edit(op: (project: Project) => Project): void;
  undo(): void;
  redo(): void;
  canUndo: boolean;
  canRedo: boolean;
  retrySave(): void;
  /** unsaved-recovered: edits from a tab that closed before they were saved. */
  recovered: Unsaved | null;
  keepRecovered(): void;
  discardRecovered(): void;
  /** Reads the project again, e.g. after another tab let go of it. */
  reload(): Promise<void>;
}

export function useProject(id: string, readOnly: boolean, now: () => number = Date.now): ProjectApi {
  const [phase, setPhase] = useState<ProjectApi['phase']>('loading');
  const [recording, setRecording] = useState<Recording>();
  const [project, setProject] = useState<Project>();
  const [save, setSave] = useState<SaveStatus>('opening');
  const [recovered, setRecovered] = useState<Unsaved | null>(null);
  const current = useRef<Project | undefined>(undefined);
  const changes = useRef(0);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  const persist = useCallback((next: Project, counted: boolean) => {
    if (counted) changes.current += 1;
    writeUnsaved({ project: next, changes: changes.current, at: now() });
    setSave('saving');
    putProject(next).then(() => {
      if (current.current !== next) return;
      changes.current = 0;
      clearUnsaved(next.id);
      setSave('saved');
    }, (error: unknown) => {
      console.error('Klipkord: could not save the project', error);
      if (current.current === next) setSave('not-saved');
    });
  }, [now]);

  const load = useCallback(async () => {
    const rec = await getRecording(id);
    if (!rec) {
      setPhase('missing');
      return;
    }
    const stored = await getProject(id);
    // v1 and v2 recordings get their project the first time they open.
    const p = stored ?? fromRecording(rec);
    current.current = p;
    setRecording(rec);
    setProject(p);
    // Kept edits older than the saved project already landed.
    const kept = readUnsaved(id);
    if (kept && kept.at <= p.updatedAt) clearUnsaved(id);
    setRecovered(kept && kept.at > p.updatedAt ? kept : null);
    setPhase('ready');
    if (stored) setSave('saved');
    else persist(p, false);
  }, [id, persist]);

  useEffect(() => {
    load().catch((error: unknown) => {
      console.error('Klipkord: could not open the project', error);
      setPhase('missing');
    });
  }, [load]);

  // The transcript can still be on its way; the column turns on when it lands.
  const pending = !!recording?.transcriptPending;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      getRecording(id).then((r) => { if (r && !r.transcriptPending) setRecording(r); }, (error: unknown) => console.error('Klipkord: could not read the recording', error));
    }, TRANSCRIPT_POLL_MS);
    return () => clearInterval(timer);
  }, [id, pending]);

  useEffect(() => {
    const flush = () => void flushProjects();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const apply = useCallback((op: (p: Project) => Project, counted = true) => {
    const before = current.current;
    if (!before || readOnlyRef.current) return;
    const next = op(before);
    if (next === before) return;
    current.current = next;
    setProject(next);
    persist(next, counted);
  }, [persist]);

  return {
    phase, recording, project, save,
    edit: apply,
    undo: () => apply(undoStep),
    redo: () => apply(redoStep),
    canUndo: !!project && canUndo(project),
    canRedo: !!project && canRedo(project),
    retrySave: () => { if (current.current) persist(current.current, false); },
    recovered,
    keepRecovered() {
      const kept = recovered;
      setRecovered(null);
      if (!kept) return;
      changes.current = kept.changes;
      // The copy has no undo history, so the kept edits come back as one step on top of this tab's.
      apply((p) => commit(p, 'Kept unsaved edits', { ...kept.project, history: p.history }, now()), false);
    },
    discardRecovered() {
      setRecovered(null);
      clearUnsaved(id);
    },
    reload: load,
  };
}
