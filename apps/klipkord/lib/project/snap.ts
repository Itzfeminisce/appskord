import { MIN_KEPT_MS } from '../editList';
import { editCut, LABELS } from './ops';
import { spans } from './time';
import type { Clip, Project } from './types';

/** Something an edge can snap to, in recording ms: a word start, a click or a marker (chapter, layout switch). */
export interface SnapPoint { rec: number; kind: 'word' | 'click' | 'marker'; label: string }

/** The snap hint's quoted name for a click; words and markers show their own text. */
export const CLICK_LABEL = 'Click';

export interface SnapSources {
  words?: readonly { start: number; text: string }[];
  clicks?: readonly number[];
  markers?: readonly { at: number; title: string }[];
}

/** Every snap point, sorted by time. */
export function snapPoints({ words = [], clicks = [], markers = [] }: SnapSources): SnapPoint[] {
  const points: SnapPoint[] = [
    ...words.map((w): SnapPoint => ({ rec: w.start, kind: 'word', label: w.text.trim() })),
    ...clicks.map((t): SnapPoint => ({ rec: t, kind: 'click', label: CLICK_LABEL })),
    ...markers.map((m): SnapPoint => ({ rec: m.at, kind: 'marker', label: m.title })),
  ];
  return points.sort((a, b) => a.rec - b.rec);
}

/** The point nearest `rec` within `threshold` ms, by binary search; markers win a tie, then clicks. */
export function nearestPoint(points: readonly SnapPoint[], rec: number, threshold: number): SnapPoint | null {
  if (points.length === 0 || !(threshold > 0)) return null;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.rec < rec) lo = mid + 1;
    else hi = mid;
  }
  const rank = { marker: 0, click: 1, word: 2 } as const;
  let best: SnapPoint | null = null;
  for (let i = lo - 1; i >= 0 && rec - points[i]!.rec <= threshold; i -= 1) best = better(best, points[i]!, rec, rank);
  for (let i = lo; i < points.length && points[i]!.rec - rec <= threshold; i += 1) best = better(best, points[i]!, rec, rank);
  return best;
}

function better(best: SnapPoint | null, p: SnapPoint, rec: number, rank: Record<SnapPoint['kind'], number>): SnapPoint {
  if (!best) return p;
  const d = Math.abs(p.rec - rec);
  const e = Math.abs(best.rec - rec);
  if (d !== e) return d < e ? p : best;
  return rank[p.kind] < rank[best.kind] ? p : best;
}

/** Snaps `rec` unless snapping is off or Alt is held (`free`); returns the time and what it snapped to. */
export function snapRec(points: readonly SnapPoint[], rec: number, threshold: number, free = false): { rec: number; point: SnapPoint | null } {
  const point = free ? null : nearestPoint(points, rec, threshold);
  return { rec: point ? point.rec : rec, point };
}

export type Edge = 'start' | 'end';

/**
 * Moves one edge of a clip to recording time `rec` (start: its in point, end: its out point), one "Trimmed a clip" step.
 * The clip keeps at least MIN_KEPT_MS and stays inside 0..`max`; a gap clip's edges change its length instead.
 */
export function trimClip(project: Project, { id, edge, rec, max }: { id: string; edge: Edge; rec: number; max: number }): Project {
  return editCut(project, LABELS.trim, (cut) => {
    const clip = cut.clips.find((c) => c.id === id);
    if (!clip) return cut;
    const next = trimmed(clip, edge, rec, max);
    if (next.in === clip.in && next.out === clip.out) return cut;
    return { ...cut, clips: cut.clips.map((c) => (c === clip ? next : c)) };
  });
}

function trimmed(clip: Clip, edge: Edge, rec: number, max: number): Clip {
  if (clip.gap) {
    // A gap is in..out of nothing: its start edge moving right shortens it like its end edge moving left.
    const len = clip.out - clip.in;
    const change = edge === 'start' ? clip.in - rec : rec - clip.out;
    return { ...clip, in: 0, out: Math.max(MIN_KEPT_MS, len + change) };
  }
  if (edge === 'start') return { ...clip, in: Math.round(Math.min(Math.max(0, rec), clip.out - MIN_KEPT_MS)) };
  return { ...clip, out: Math.round(Math.max(Math.min(max, rec), clip.in + MIN_KEPT_MS)) };
}

/** The recording time under output time `out` if it fell inside clip `index`, even past its edges (for dragging an edge). */
export function recAtEdge(clips: Clip[], index: number, out: number): number | null {
  const s = spans({ clips } as Parameters<typeof spans>[0])[index];
  if (!s) return null;
  return s.clip.in + (out - s.start) * (s.clip.gap ? 1 : s.clip.speed);
}
