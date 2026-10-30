import { applyPatch } from '../patch';
import type { Author, Change, PatchOp } from '../types';

/** `past` is Clip.history (oldest first, shared with the Changes tab); `future` is what Redo brings back. */
export interface History { past: Change[]; future: Change[]; mergeKey?: string; mergeStart?: number }

/** Keystrokes and nudges on the same thing within this window become one change. */
export const MERGE_MS = 1500;
/** A merged change stops growing this long after its first edit, so steady typing still leaves undo steps. */
export const MERGE_CAP_MS = 5000;

export interface RecordMeta { by: Author; summary: string; at: number; id: string; mergeKey?: string }

const allReplace = (ops: PatchOp[]) => ops.every((o) => o.op === 'replace');
const paths = (ops: PatchOp[]) => ops.map((o) => o.path).join('\n');

/** Applies ops and records them as one Change. Throws PatchError (nothing changed) when they cannot apply. */
export function record<T>(doc: T, h: History, ops: PatchOp[], meta: RecordMeta): { doc: T; history: History; change: Change } {
  const { doc: next, inverse } = applyPatch(doc, ops);
  const last = h.past[h.past.length - 1];
  if (meta.mergeKey && last && h.mergeKey === meta.mergeKey && last.by === meta.by && h.future.length === 0 && meta.at - last.at < MERGE_MS
    && meta.at - (h.mergeStart ?? last.at) < MERGE_CAP_MS) {
    // Same paths replaced again: the newest values are the whole patch; otherwise run both in order.
    const same = allReplace(last.patch) && allReplace(ops) && paths(last.patch) === paths(ops);
    const change: Change = {
      ...last, at: meta.at, summary: meta.summary,
      patch: same ? ops : [...last.patch, ...ops],
      inverse: same ? last.inverse : [...inverse, ...last.inverse],
    };
    return { doc: next, history: { past: [...h.past.slice(0, -1), change], future: [], mergeKey: meta.mergeKey, mergeStart: h.mergeStart ?? last.at }, change };
  }
  const change: Change = { id: meta.id, at: meta.at, by: meta.by, summary: meta.summary, patch: ops, inverse };
  return { doc: next, history: { past: [...h.past, change], future: [], mergeKey: meta.mergeKey, mergeStart: meta.at }, change };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

/** Undoes the newest change with its inverse. Returns the input unchanged when there is nothing to undo. */
export function undo<T>(doc: T, h: History): { doc: T; history: History; change?: Change } {
  const last = h.past[h.past.length - 1];
  if (!last) return { doc, history: h };
  const { doc: next } = applyPatch(doc, last.inverse);
  return { doc: next, history: { past: h.past.slice(0, -1), future: [...h.future, last] }, change: last };
}

/** Re-applies the newest undone change. */
export function redo<T>(doc: T, h: History): { doc: T; history: History; change?: Change } {
  const next = h.future[h.future.length - 1];
  if (!next) return { doc, history: h };
  const { doc: out } = applyPatch(doc, next.patch);
  return { doc: out, history: { past: [...h.past, next], future: h.future.slice(0, -1) }, change: next };
}
