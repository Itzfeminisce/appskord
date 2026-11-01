import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import {
  defaultFit, deleteCut, duplicateCut, FULL_CUT_NAME, newCut, PLAIN_LOOK, recordingLength, renameCut, selectCut, setShape,
} from './cuts';
import { currentCut, steps, undo } from './history';
import { fromRecording } from './migrate';
import { cutRange } from './ops';
import type { Project, Source } from './types';

const src = (id: string, kind: Source['kind'], offset: number, duration: number): Source =>
  ({ id, kind, file: `${id}.webm`, mime: 'video/webm', offset, duration, video: kind !== 'mic', audio: kind === 'mic' });
const sources = [src('screen', 'screen', 0, 10_000), src('camera', 'camera', 40, 9_900), src('mic', 'mic', 0, 10_050), src('m', 'media', 0, 60_000)];
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], v3: { sources: ['screen', 'camera', 'mic'], events: true } } as unknown as Recording;
const base = (): Project => fromRecording(rec, sources);
const ends = (p: Project) => currentCut(p).clips.map((c) => [c.in, c.out]);

describe('cuts', () => {
  it('measures the recording from recorded sources only', () => {
    expect(recordingLength(sources)).toBe(10_050);
    expect(defaultFit(sources, true)).toBe('stack');
    expect(defaultFit([sources[0]!], true)).toBe('follow');
    expect(defaultFit([sources[0]!], false)).toBe('bars');
  });

  it('makes a new cut from the full recording, untouched by edits in the first', () => {
    const edited = cutRange(base(), { from: 1000, to: 2000 });
    const p = newCut(edited, { name: 'Shorts', shape: '9:16' });
    expect(p.cuts).toHaveLength(2);
    expect(currentCut(p)).toMatchObject({ name: 'Shorts', shape: '9:16', made: 'manual', fit: 'stack' });
    expect(ends(p)).toEqual([[0, 10_050]]);
    expect(p.history[p.current]).toEqual({ undo: [], redo: [] });
  });

  it('keeps edits in one cut from touching another', () => {
    const b = base();
    const p = duplicateCut(b, { id: b.current, name: 'LinkedIn 30s' });
    const first = p.cuts[0]!.id;
    const edited = cutRange(p, { from: 0, to: 5000 });
    expect(edited.cuts[0]!.clips).toBe(p.cuts[0]!.clips);
    expect(ends(edited)).toEqual([[5000, 10_050]]);
    const back = selectCut(edited, { id: first });
    expect(ends(back)).toEqual([[0, 10_050]]);
    expect(steps(back).steps).toEqual([]);
    expect(undo(back)).toBe(back);
  });

  it('duplicates, renames and deletes, never the last cut', () => {
    const one = base();
    const two = duplicateCut(one, { id: one.current, name: ' Copy ' });
    expect(currentCut(two)).toMatchObject({ name: 'Copy', made: 'duplicate' });
    expect(currentCut(two).id).not.toBe(one.current);
    expect(renameCut(two, { id: two.current, name: '  ' })).toBe(two);
    expect(currentCut(renameCut(two, { id: two.current, name: 'Shorts' })).name).toBe('Shorts');
    const left = deleteCut(two, { id: two.current });
    expect(left.cuts.map((c) => c.name)).toEqual([FULL_CUT_NAME]);
    expect(left.current).toBe(one.current);
    expect(Object.keys(left.history)).toEqual([one.current]);
    expect(deleteCut(left, { id: left.current })).toBe(left);
  });

  it('sets the shape as one undoable step', () => {
    const p = setShape(base(), { shape: '9:16', fit: 'follow' });
    expect(currentCut(p)).toMatchObject({ shape: '9:16', fit: 'follow' });
    expect(steps(p).steps[0]?.label).toBe('Changed shape to 9:16');
    expect(currentCut(undo(p)).shape).toBe('16:9');
    expect(setShape(p, { shape: '9:16' })).toBe(p);
  });

  it('gives a baked recording a plain frame', () => {
    const old = fromRecording({ ...rec, v3: undefined });
    expect(currentCut(newCut(old, { name: 'Shorts' })).look).toEqual(PLAIN_LOOK);
  });
});
