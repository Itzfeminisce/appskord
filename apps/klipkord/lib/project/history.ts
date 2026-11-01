import type { Cut, Project, Step, Undoable } from './types';

/** Steps kept per cut; the oldest go first. */
export const MAX_STEPS = 200;

export function currentCut(project: Project): Cut {
  const cut = project.cuts.find((c) => c.id === project.current) ?? project.cuts[0];
  if (!cut) throw new Error('Klipkord: a project always has a cut');
  return cut;
}

const SHARED = ['wordFixes', 'chapters', 'translations'] as const;

/** The cut plus only the project-level fields `next` changed, so undo in one cut never resets another cut's later edits. */
function snapshot(project: Project, next: Project): Undoable {
  const state: Undoable = { cut: currentCut(project) };
  for (const key of SHARED) if (next[key] !== project[key]) Object.assign(state, { [key]: project[key] });
  return state;
}

/** The cut plus the same fields `state` holds, read from `project`: what the opposite stack needs. */
function mirror(project: Project, state: Undoable): Undoable {
  const out: Undoable = { cut: currentCut(project) };
  for (const key of SHARED) if (key in state) Object.assign(out, { [key]: project[key] });
  return out;
}

function restore(project: Project, state: Undoable): Project {
  const back: Project = { ...project, cuts: project.cuts.map((c) => (c.id === state.cut.id ? state.cut : c)) };
  for (const key of SHARED) if (key in state) Object.assign(back, { [key]: state[key] });
  return back;
}

const stacks = (project: Project) => project.history[project.current] ?? { undo: [], redo: [] };

function withStacks(project: Project, undo: Step[], redo: Step[]): Project {
  return { ...project, history: { ...project.history, [project.current]: { undo, redo } } };
}

/**
 * Records `next` as one named step after `project` on the current cut. Redo is cleared.
 * Returns `project` itself when nothing changed.
 */
export function commit(project: Project, label: string, next: Project, at: number = Date.now()): Project {
  if (next === project) return project;
  const step: Step = { label, before: snapshot(project, next), at };
  const undo = [...stacks(project).undo, step].slice(-MAX_STEPS);
  return withStacks({ ...next, current: project.current }, undo, []);
}

/** Groups several edits into one step, e.g. an applied AI draft: their own steps are dropped. */
export function group(project: Project, label: string, edit: (p: Project) => Project, at?: number): Project {
  const next = edit(project);
  return commit(project, label, { ...next, history: project.history }, at);
}

export function canUndo(project: Project): boolean {
  return stacks(project).undo.length > 0;
}
export function canRedo(project: Project): boolean {
  return stacks(project).redo.length > 0;
}

export function undo(project: Project): Project {
  const { undo: done, redo } = stacks(project);
  const step = done[done.length - 1];
  if (!step) return project;
  const back = restore(project, step.before);
  return withStacks(back, done.slice(0, -1), [...redo, { ...step, before: mirror(project, step.before) }]);
}

export function redo(project: Project): Project {
  const { undo: done, redo: ahead } = stacks(project);
  const step = ahead[ahead.length - 1];
  if (!step) return project;
  const forward = restore(project, step.before);
  return withStacks(forward, [...done, { ...step, before: mirror(project, step.before) }], ahead.slice(0, -1));
}

/** Every step of the current cut, oldest first; the first `applied` are done, the rest are undone. */
export function steps(project: Project): { steps: Step[]; applied: number } {
  const { undo: done, redo: ahead } = stacks(project);
  return { steps: [...done, ...[...ahead].reverse()], applied: done.length };
}

/** Moves to the state after the first `index` steps (0: before every step). */
export function goTo(project: Project, index: number): Project {
  const total = steps(project).steps.length;
  const target = Math.max(0, Math.min(total, Math.floor(index)));
  let p = project;
  while (steps(p).applied > target) p = undo(p);
  while (steps(p).applied < target) p = redo(p);
  return p;
}
