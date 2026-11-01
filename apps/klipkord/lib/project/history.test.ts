import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, commit, currentCut, goTo, group, MAX_STEPS, redo, steps, undo } from './history';
import { newCut, selectCut } from './cuts';
import { fromRecording } from './migrate';
import { addChapter, cutRange, fixWord } from './ops';
import type { Recording } from '../types';
import type { Project } from './types';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [] } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const ends = (p: Project) => currentCut(p).clips.map((c) => [c.in, c.out]);

describe('history', () => {
  it('commits named steps, undoes and redoes the cut', () => {
    const p0 = base();
    const p1 = cutRange(p0, { from: 1000, to: 2000 });
    const p2 = cutRange(p1, { from: 5000, to: 6000, label: 'Cut 19 with Clean up' });
    expect(steps(p2).steps.map((s) => s.label)).toEqual(['Cut a part', 'Cut 19 with Clean up']);
    const u = undo(p2);
    expect(ends(u)).toEqual(ends(p1));
    expect(canRedo(u)).toBe(true);
    expect(ends(redo(u))).toEqual(ends(p2));
    expect(ends(undo(undo(p2)))).toEqual(ends(p0));
    expect(canUndo(undo(undo(p2)))).toBe(false);
    expect(undo(p0)).toBe(p0);
    expect(redo(p2)).toBe(p2);
  });

  it('clears redo on a new commit', () => {
    const p = undo(cutRange(base(), { from: 1000, to: 2000 }));
    const q = cutRange(p, { from: 3000, to: 4000 });
    expect(canRedo(q)).toBe(false);
    expect(steps(q).steps).toHaveLength(1);
  });

  it('goes to any step, back and forward', () => {
    let p = base();
    for (let i = 0; i < 4; i++) p = cutRange(p, { from: i * 2000 + 500, to: i * 2000 + 1000 });
    const two = goTo(p, 2);
    expect(steps(two).applied).toBe(2);
    expect(ends(two)).toEqual([[0, 500], [1000, 2500], [3000, 10_000]]);
    expect(ends(goTo(two, 4))).toEqual(ends(p));
    expect(ends(goTo(p, 0))).toEqual([[0, 10_000]]);
    expect(steps(goTo(p, 99)).applied).toBe(4);
  });

  it('undoes word fixes and chapters too', () => {
    const p = addChapter(fixWord(base(), { index: 3, text: 'Members' }), { chapter: { at: 0, title: 'Intro' } });
    expect(p.wordFixes).toEqual({ 3: 'Members' });
    const back = undo(undo(p));
    expect(back.wordFixes).toEqual({});
    expect(back.chapters).toEqual([]);
  });

  it('undo in one cut keeps project-level edits made later in another cut', () => {
    const one = cutRange(base(), { from: 1000, to: 2000 });
    const first = one.current;
    const two = fixWord(addChapter(newCut(one, { name: 'Shorts' }), { chapter: { at: 0, title: 'Intro' } }), { index: 3, text: 'Members' });
    const back = undo(selectCut(two, { id: first }));
    expect(back.wordFixes).toEqual({ 3: 'Members' });
    expect(back.chapters).toEqual([{ at: 0, title: 'Intro' }]);
    expect(ends(back)).toEqual([[0, 10_000]]);
    expect(ends(redo(back))).toEqual([[0, 1000], [2000, 10_000]]);
    const step = steps(one).steps[0]!;
    expect(Object.keys(step.before)).toEqual(['cut']);
    const fix = fixWord(base(), { index: 1, text: 'Hi' });
    expect(Object.keys(steps(fix).steps[0]!.before).sort()).toEqual(['cut', 'wordFixes']);
    const redone = redo(undo(fix));
    expect(redone.wordFixes).toEqual({ 1: 'Hi' });
    expect(Object.keys(steps(redone).steps[0]!.before).sort()).toEqual(['cut', 'wordFixes']);
  });

  it('keeps 200 steps per cut', () => {
    let p = base();
    for (let i = 0; i < MAX_STEPS + 5; i++) p = commit(p, `Step ${i}`, { ...p, wordFixes: { 0: String(i) } }, i);
    const list = steps(p).steps;
    expect(list).toHaveLength(MAX_STEPS);
    expect(list[0]?.label).toBe('Step 5');
  });

  it('skips a commit that changes nothing and groups edits into one step', () => {
    const p = base();
    expect(commit(p, 'x', p)).toBe(p);
    const g = group(p, 'Applied AI edit · 6 changes', (q) => cutRange(cutRange(q, { from: 0, to: 500 }), { from: 900, to: 1200 }));
    expect(steps(g).steps.map((s) => s.label)).toEqual(['Applied AI edit · 6 changes']);
    expect(ends(undo(g))).toEqual([[0, 10_000]]);
  });
});
