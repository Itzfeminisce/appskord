import { describe, expect, it } from 'vitest';
import { canUndo, currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { cutLength, toOut } from '@/lib/project/time';
import type { Project } from '@/lib/project/types';
import type { Recording, Segment } from '@/lib/types';
import { units as unitsOf } from '@/lib/wordCuts';
import {
  chapterAt, cutFromRange, cutMatches, DEFAULT_ZOOM_DEPTH, deleteRange, findMatches, lineViews, moveBefore, outAt, outSpan, replaceAll, replaceOne,
  speedRange, zoomRanges,
} from './model';

function line(at: number, text: string): Segment {
  const words = text.split(' ').map((w, i) => ({ start: at + i * 1000, end: at + i * 1000 + 800, text: w }));
  return { start: at, end: words.at(-1)!.end, text, words };
}
const transcript = [line(0, 'Hi, invite your team.'), line(6000, 'Click Invite now.'), line(12_000, 'Pick a role.')];
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 16_000, mime: 'video/webm', quality: '1080p', edits: [], transcript } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const units = unitsOf(transcript);
const label = (p: Project) => steps(p).steps.at(-1)?.label;
const lines = lineViews(units, []);

describe('transcript lines', () => {
  it('groups words into lines with chapters and long pauses', () => {
    const views = lineViews(units, [{ at: 0, title: 'Intro' }, { at: 11_000, title: 'Roles' }]);
    expect(views.map((v) => [v.first, v.last])).toEqual([[0, 3], [4, 6], [7, 9]]);
    expect(views.map((v) => v.chapters.map((c) => c.title))).toEqual([['Intro'], [], ['Roles']]);
    expect(views[1]!.pause).toEqual({ start: 3800, end: 6000 });
    expect(views[2]!.pause).toEqual({ start: 8800, end: 12_000 });
  });

  it('reads a cut moment as where the video carries on', () => {
    const p = deleteRange(base(), units, { lo: 1, hi: 2 });
    expect(outAt(currentCut(p), 1500)).toBe(toOut(currentCut(p), 2800));
  });
});

describe('selection bar actions', () => {
  it('Delete cuts the words', () => {
    const p = deleteRange(base(), units, { lo: 1, hi: 2 });
    expect(label(p)).toBe('Cut 2 words');
    expect(toOut(currentCut(p), 1400)).toBeNull();
  });

  it('Speed sets only the selection, as one step', () => {
    const p = speedRange(base(), units, { lo: 4, hi: 6 }, 2);
    expect(label(p)).toBe('Set speed to 2x');
    expect(steps(p).steps).toHaveLength(1);
    const fast = currentCut(p).clips.filter((c) => c.speed === 2);
    expect(fast).toHaveLength(1);
    expect([fast[0]!.in, fast[0]!.out]).toEqual([6000, 8800]);
  });

  it('Zoom adds a zoom with the default depth over the words', () => {
    const p = zoomRanges(base(), units, [{ lo: 4, hi: 5 }]);
    expect(label(p)).toBe('Added a zoom');
    expect(currentCut(p).zooms[0]).toMatchObject({ at: 6000, end: 7800, depth: DEFAULT_ZOOM_DEPTH, auto: false });
  });

  it('Chapter starts a chapter at the first word', () => {
    const p = chapterAt(base(), units, { lo: 4, hi: 6 });
    expect(p.chapters).toEqual([{ at: 6000, title: 'Click Invite now' }]);
    expect(label(p)).toBe('Added the chapter “Click Invite now”');
  });

  it('More → make a cut from this plays only the selection', () => {
    const p = cutFromRange(base(), units, { lo: 4, hi: 6 });
    expect(p.cuts).toHaveLength(2);
    expect(currentCut(p).name).toBe('Click Invite now');
    expect(cutLength(currentCut(p))).toBe(2800);
    expect(canUndo(p)).toBe(false);
  });

  it('a cut made from a selection starts from the current cut', () => {
    const trimmed = deleteRange(base(), units, { lo: 5, hi: 5 });
    const p = cutFromRange(trimmed, units, { lo: 4, hi: 6 });
    expect(cutLength(currentCut(p))).toBe(2000);
  });

  it('dragging the selection moves it before another word', () => {
    const p = moveBefore(base(), units, { lo: 7, hi: 9 }, 0, lines);
    expect(label(p)).toBe('Moved “Pick a role.” before “Hi, invite your…”');
    expect(currentCut(p).clips[0]!.in).toBe(12_000);
  });

  it('a drop inside the selection does nothing', () => {
    const p = base();
    expect(moveBefore(p, units, { lo: 4, hi: 6 }, 5, lines)).toBe(p);
    expect(outSpan(currentCut(p), units, { lo: 4, hi: 6 })).toEqual({ from: 6000, to: 8800 });
  });
});

describe('find and replace', () => {
  it('finds case-insensitive matches in kept words', () => {
    const p = base();
    expect(findMatches(units, {}, currentCut(p), 'invite').map((m) => m.lo)).toEqual([1, 5]);
    const cutOne = deleteRange(p, units, { lo: 5, hi: 5 });
    expect(findMatches(units, {}, currentCut(cutOne), 'invite').map((m) => m.lo)).toEqual([1]);
    expect(findMatches(units, {}, currentCut(p), 'your team').map((m) => [m.lo, m.hi])).toEqual([[2, 3]]);
  });

  it('replaces one match through fixWord', () => {
    const p = base();
    const [m] = findMatches(units, {}, currentCut(p), 'invite');
    const next = replaceOne(p, units, m!, 'add');
    expect(next.wordFixes).toEqual({ 1: 'add' });
    expect(label(next)).toBe('Fixed “add”');
  });

  it('replaces all as one step, keeping punctuation', () => {
    const p = base();
    const matches = findMatches(units, {}, currentCut(p), 'Invite');
    const next = replaceAll(p, units, matches, 'Invite', 'Add people');
    expect(next.wordFixes).toEqual({ 1: 'Add people', 5: 'Add people' });
    expect(label(next)).toBe('Replaced “Invite” with “Add people”');
    expect(steps(next).steps).toHaveLength(1);
  });

  it('cuts and zooms on every match', () => {
    const p = base();
    const matches = findMatches(units, {}, currentCut(p), 'invite');
    expect(label(cutMatches(p, units, matches))).toBe('Cut 2 words');
    const zoomed = zoomRanges(p, units, matches);
    expect(label(zoomed)).toBe('Added 2 zooms');
    expect(currentCut(zoomed).zooms).toHaveLength(2);
  });
});
