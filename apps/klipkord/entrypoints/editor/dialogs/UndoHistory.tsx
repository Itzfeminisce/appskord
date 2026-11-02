import { useCallback, useEffect, useRef, useState } from 'react';
import { goTo, redo, steps } from '@/lib/project/history';
import { LABELS } from '@/lib/project/ops';
import type { Project } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { floating, useEscape, useOutside } from '../timeline/controls';
import { C } from '../ui';

/** "now", "2 min". */
export const ago = (at: number, now: number): string => {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  return min < 1 ? 'now' : `${min} min`;
};

export interface HistoryRow { label: string; index: number; state: 'done' | 'current' | 'undone'; time: string }

/** UndoHistory rows, newest on top: undone steps (greyed, "redo"), the current one, older ones, then "Opened the project". */
export function historyRows(project: Project, openedAt: number, now: number): HistoryRow[] {
  const { steps: all, applied } = steps(project);
  const rows: HistoryRow[] = all.map((s, i) => ({
    label: s.label, index: i + 1, time: i < applied ? ago(s.at, now) : 'redo',
    state: i < applied - 1 ? 'done' : i === applied - 1 ? 'current' : 'undone',
  }));
  rows.reverse();
  rows.push({ label: LABELS.opened, index: 0, state: applied === 0 ? 'current' : 'done', time: ago(openedAt, now) });
  return rows;
}

/** UndoHistory: right-click or hold Undo. Click a step to go back to it. */
export function UndoHistory({ p, onClose, now = Date.now() }: { p: SlotProps; onClose: () => void; now?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useOutside(useCallback(() => ref.current, []), onClose);
  const rows = historyRows(p.project, p.recording.createdAt, now);
  const undoRect = document.querySelector('[aria-label="Undo (Ctrl+Z)"]')?.getBoundingClientRect();
  const right = undoRect ? Math.max(8, window.innerWidth - undoRect.right + 3) : 300;
  return (
    <div ref={ref} role="dialog" aria-label="Undo history" style={{ ...floating, position: 'fixed', right, top: 44 }}>
      <div style={{ padding: 8, width: 336, display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 480, overflowY: 'auto' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, padding: '4px 10px' }}>{`History of “${p.cut.name}”`}</span>
        {rows.map((r) => (
          <button key={r.index} type="button" aria-current={r.state === 'current' ? 'step' : undefined} disabled={p.readOnly}
            onClick={() => p.edit((project) => goTo(project, r.index))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px', border: 0, borderRadius: 7, fontFamily: 'inherit', fontSize: 13, textAlign: 'left', cursor: 'pointer',
              background: r.state === 'current' ? C.tabOn : 'transparent', color: r.state === 'undone' ? C.muted : C.text }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: r.state === 'current' ? C.accentText : r.state === 'undone' ? C.line : C.secondary }} />
            <span style={{ flexGrow: 1 }}>{r.label}</span>
            <span style={{ fontSize: 11.5, color: C.muted }}>{r.time}</span>
          </button>
        ))}
        <span style={{ fontSize: 11.5, color: C.muted, padding: '6px 10px', lineHeight: 1.45 }}>Click a step to go back to it. History is kept with the project, even after you close the tab.</span>
      </div>
    </div>
  );
}

/** What one Undo or Redo just did, from the history before and after; null for any other change. */
export function undoneStep(before: Project | undefined, after: Project): { text: string; redo: boolean } | null {
  if (!before || before.current !== after.current) return null;
  const a = steps(before);
  const b = steps(after);
  if (a.steps.length !== b.steps.length) return null;
  if (b.applied === a.applied - 1) return { text: `Undone: ${b.steps[b.applied]!.label}`, redo: true };
  if (b.applied === a.applied + 1) return { text: `Redone: ${b.steps[a.applied]!.label}`, redo: false };
  return null;
}

const TOAST_MS = 5000;

/** The "Undone: <step>" toast with Redo; "Redone: <step>" after a redo. */
export function UndoToast({ p }: { p: SlotProps }) {
  const last = useRef<Project | undefined>(undefined);
  const [toast, setToast] = useState<{ text: string; redo: boolean } | null>(null);
  useEffect(() => {
    const step = undoneStep(last.current, p.project);
    last.current = p.project;
    if (step) setToast(step);
  }, [p.project]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  if (!toast) return null;
  return (
    <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 248, zIndex: 16, display: 'flex', alignItems: 'center', gap: 12, padding: toast.redo ? '8px 8px 8px 14px' : '8px 14px', borderRadius: 10, background: C.text, color: C.ground, fontSize: 13, fontWeight: 500, boxShadow: '0 10px 30px rgba(0,0,0,0.4)', maxWidth: 520 }}>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.text}</span>
      {toast.redo && (
        <button type="button" onClick={() => { setToast(null); p.edit(redo); }}
          style={{ height: 28, padding: '0 10px', borderRadius: 7, background: 'transparent', border: '1px solid #D4D4D8', color: C.ground, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>Redo</button>
      )}
    </div>
  );
}
