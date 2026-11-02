import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import { currentCut, steps } from './history';
import { fromRecording } from './migrate';
import { split } from './ops';
import { nearestPoint, recAtEdge, snapPoints, snapRec, trimClip } from './snap';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [] } as unknown as Recording;

describe('snapping', () => {
  const points = snapPoints({ words: [{ start: 1000, text: 'Open' }, { start: 3000, text: 'Settings' }], clicks: [3050], markers: [{ at: 6000, title: 'Roles' }] });

  it('sorts word starts, clicks and markers by time', () => {
    expect(points.map((p) => [p.rec, p.kind, p.label])).toEqual([[1000, 'word', 'Open'], [3000, 'word', 'Settings'], [3050, 'click', 'Click'], [6000, 'marker', 'Roles']]);
  });

  it('finds the nearest point inside the threshold, and nothing outside it', () => {
    expect(nearestPoint(points, 1080, 100)?.label).toBe('Open');
    expect(nearestPoint(points, 3040, 100)?.kind).toBe('click');
    expect(nearestPoint(points, 4500, 100)).toBeNull();
    expect(nearestPoint([], 10, 100)).toBeNull();
  });

  it('prefers a marker, then a click, on a tie', () => {
    const tie = snapPoints({ words: [{ start: 900, text: 'a' }], clicks: [1100], markers: [{ at: 1100, title: 'M' }] });
    expect(nearestPoint(tie, 1000, 200)?.kind).toBe('marker');
  });

  it('Alt or snapping off drags freely', () => {
    expect(snapRec(points, 5950, 100)).toEqual({ rec: 6000, point: points[3] });
    expect(snapRec(points, 5950, 100, true)).toEqual({ rec: 5950, point: null });
  });
});

describe('trimClip', () => {
  const p = split(fromRecording(rec), { at: 4000 });
  const [a, b] = currentCut(p).clips;

  it('moves an edge as one "Trimmed a clip" step and ripples the rest', () => {
    const t = trimClip(p, { id: a!.id, edge: 'end', rec: 3000, max: 10_000 });
    expect(currentCut(t).clips.map((c) => [c.in, c.out])).toEqual([[0, 3000], [4000, 10_000]]);
    expect(steps(t).steps.at(-1)?.label).toBe('Trimmed a clip');
  });

  it('keeps the clip inside the recording and at least 100 ms long', () => {
    expect(currentCut(trimClip(p, { id: b!.id, edge: 'end', rec: 99_000, max: 10_000 })).clips[1]!.out).toBe(10_000);
    expect(currentCut(trimClip(p, { id: b!.id, edge: 'start', rec: 99_000, max: 10_000 })).clips[1]!.in).toBe(9900);
    expect(currentCut(trimClip(p, { id: a!.id, edge: 'start', rec: -50, max: 10_000 }))).toBe(currentCut(p));
  });

  it('reads the recording time under a dragged edge, past the clip too', () => {
    expect(recAtEdge(currentCut(p).clips, 1, 3500)).toBe(3500);
    expect(recAtEdge(currentCut(p).clips, 5, 0)).toBeNull();
  });
});
