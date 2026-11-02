import { describe, expect, it } from 'vitest';
import { currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { addLayer, setSpeed, split } from '@/lib/project/ops';
import type { Project } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import { TIPS, tourTips } from '../dialogs/FirstRunTour';
import { historyRows, undoneStep } from '../dialogs/UndoHistory';
import { undo } from '@/lib/project/history';
import { deleteSelected, moveClip, runMenu, silencesIn, speedClips } from './actions';
import { chaptersInCut, youtubeChapters, youtubeText } from './chapters';
import { clampView, fitView, pieces, ticks } from './geometry';
import { passOrder, thumbStep } from './filmstrip';
import { buildRows, HINTS, selectedHeader } from './rows';
import { spans } from '@/lib/project/time';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], markers: [] } as unknown as Recording;
const words = [{ start: 0, end: 800, text: 'Hello' }, { start: 900, end: 1500, text: 'there.' }, { start: 6000, end: 6500, text: 'Second' }, { start: 6500, end: 7000, text: 'part.' }];
const twoClips = (): Project => split(fromRecording(rec), { at: 5000 });
const clips = (p: Project) => currentCut(p).clips;
const label = (p: Project) => steps(p).steps.at(-1)?.label;
const ctx = { at: 2000, clipboard: [], words };

describe('TimelineMenu actions map to ops', () => {
  it('Split here splits at the pointer as one step', () => {
    const p = twoClips();
    const r = runMenu(p, 'split', [clips(p)[0]!.id], ctx);
    expect(clips(r.project).map((c) => [c.in, c.out])).toEqual([[0, 2000], [2000, 5000], [5000, 10_000]]);
  });

  it('Speed… opens the popover and changes nothing', () => {
    const p = twoClips();
    expect(runMenu(p, 'speed', [clips(p)[0]!.id], ctx)).toEqual({ project: p, speed: true });
  });

  it('Duplicate, Copy and Paste after', () => {
    const p = twoClips();
    const id = clips(p)[0]!.id;
    expect(clips(runMenu(p, 'duplicate', [id], ctx).project)).toHaveLength(3);
    const copied = runMenu(p, 'copy', [id], ctx);
    expect(copied.project).toBe(p);
    expect(copied.clipboard?.map((c) => c.id)).toEqual([id]);
    const pasted = runMenu(p, 'paste', [clips(p)[1]!.id], { ...ctx, clipboard: copied.clipboard! });
    expect(clips(pasted.project).map((c) => [c.in, c.out])).toEqual([[0, 5000], [5000, 10_000], [0, 5000]]);
  });

  it('Delete and close the gap, Delete and leave a gap', () => {
    const p = twoClips();
    const id = clips(p)[0]!.id;
    expect(clips(runMenu(p, 'deleteClose', [id], ctx).project).map((c) => c.in)).toEqual([5000]);
    const gap = clips(runMenu(p, 'deleteGap', [id], ctx).project);
    expect(gap[0]!.gap).toBe(true);
    const both = deleteSelected(twoClips(), { kind: 'clips', ids: [] });
    expect(clips(both)).toHaveLength(2);
  });

  it('several clips deleted are one step', () => {
    const p = split(twoClips(), { at: 2000 });
    const ids = clips(p).slice(0, 2).map((c) => c.id);
    const out = runMenu(p, 'deleteClose', ids, ctx).project;
    expect(clips(out)).toHaveLength(1);
    expect(label(out)).toBe('Removed 2 clips');
    expect(steps(out).steps.length - steps(p).steps.length).toBe(1);
  });

  it('Make a cut from this makes a new current cut of that clip and asks for its name', () => {
    const p = twoClips();
    const r = runMenu(p, 'newCut', [clips(p)[1]!.id], ctx);
    expect(r.project.cuts).toHaveLength(2);
    expect(r.renaming).toBe(true);
    expect(clips(r.project).map((c) => [c.in, c.out])).toEqual([[5000, 10_000]]);
    expect(clips({ ...r.project, current: p.current })).toHaveLength(2);
  });

  it('Detach audio places the voice under the clip as its own block', () => {
    const p = { ...twoClips(), sources: [...twoClips().sources, { id: 'mic', kind: 'mic' as const, file: 'mic.webm', mime: 'audio/webm', offset: 0, duration: 10_000, video: false, audio: true }] };
    const r = runMenu(p, 'detach', [clips(p)[1]!.id], ctx);
    expect(currentCut(r.project).media).toMatchObject([{ source: 'mic', at: 5000, trim: [5000, 10_000], muteOriginal: true }]);
  });

  it('Detach audio covers a sped-up clip in recording time and starts where the sound file starts', () => {
    const base = twoClips();
    const fast = setSpeed(base, { ids: [clips(base)[0]!.id], speed: 2 });
    const p = { ...fast, sources: [...fast.sources, { id: 'mic', kind: 'mic' as const, file: 'mic.webm', mime: 'audio/webm', offset: 1000, duration: 3000, video: false, audio: true }] };
    const r = runMenu(p, 'detach', [clips(p)[0]!.id], ctx);
    expect(currentCut(r.project).media).toMatchObject([{ source: 'mic', at: 1000, trim: [0, 3000] }]);
  });

  it('drag to reorder moves a clip with a named step, and to the end', () => {
    const p = twoClips();
    const [a, b] = clips(p);
    const moved = moveClip(p, { id: b!.id, at: 0, words });
    expect(clips(moved).map((c) => c.id)).toEqual([b!.id, a!.id]);
    expect(label(moved)).toBe('Moved “Second part.” before “Hello there.”');
    const end = moveClip(p, { id: a!.id, at: 10_000, words });
    expect(clips(end).map((c) => c.id)).toEqual([b!.id, a!.id]);
  });

  it('speed up only the silences finds pauses from the words', () => {
    expect(silencesIn(words, 0, 10_000)).toEqual([{ start: 1650, end: 5850 }, { start: 7150, end: 10_000 }]);
    const p = twoClips();
    const out = speedClips(p, [clips(p)[0]!.id], { speed: 2, silences: true }, words);
    expect(clips(out).filter((c) => c.silencesOnly).map((c) => c.speed)).toEqual([1, 2]);
  });
});

describe('chapters for YouTube', () => {
  const p = { ...twoClips(), chapters: [{ at: 1000, title: 'Intro' }, { at: 3000, title: 'Gone' }, { at: 5500, title: 'Roles' }, { at: 9500, title: 'End' }] };

  it('chapters follow the cut: a cut-away one moves to the next kept part', () => {
    const cut = { ...currentCut(p), clips: [currentCut(p).clips[1]!, currentCut(p).clips[0]!] };
    const cutAway = { ...cut, clips: [{ ...cut.clips[0]!, in: 6000 }, cut.clips[1]!] };
    expect(chaptersInCut(p, cutAway)[0]).toMatchObject({ title: 'Roles', at: 0 });
    expect(chaptersInCut(p, cut).map((c) => [c.title, c.at])).toEqual([['Roles', 500], ['End', 4500], ['Intro', 6000], ['Gone', 8000]]);
  });

  it('the first is at 0:00, each at least 10 s, and none in the last 10 s', () => {
    const list = [{ index: 0, at: 3000, title: 'Intro' }, { index: 1, at: 8000, title: 'Too soon' }, { index: 2, at: 20_000, title: 'Roles' }, { index: 3, at: 55_000, title: 'Last' }];
    expect(youtubeText(youtubeChapters(list, 60_000))).toBe('0:00 Intro\n0:20 Roles');
  });
});

describe('the first-run tour', () => {
  it('runs transcript, then timeline, then Ask AI and Export; tips without copy or target are skipped', () => {
    expect(TIPS.map((t) => t.id)).toEqual(['transcript', 'timeline', 'ask', 'export']);
    expect(tourTips(TIPS, () => true).map((t) => t.id)).toEqual(['transcript', 'timeline', 'ask', 'export']);
    expect(tourTips(TIPS, (s) => !s.includes('Transcript')).map((t) => t.id)).toEqual(['timeline', 'ask', 'export']);
  });
});

describe('undo history', () => {
  it('lists steps newest on top with the current one marked and Opened the project last', () => {
    const p = undo(split(split(fromRecording(rec), { at: 5000 }), { at: 2000 }));
    const rows = historyRows(p, 0, 120_000);
    expect(rows.map((r) => [r.label, r.state, r.time])).toEqual([
      ['Split a clip at 00:02', 'undone', 'redo'], ['Split a clip at 00:05', 'current', expect.any(String)], ['Opened the project', 'done', '2 min'],
    ]);
  });

  it('names what one Undo or Redo did, for the toast', () => {
    const a = split(fromRecording(rec), { at: 5000 });
    const b = undo(a);
    expect(undoneStep(a, b)).toEqual({ text: 'Undone: Split a clip at 00:05', redo: true });
    expect(undoneStep(b, a)).toEqual({ text: 'Redone: Split a clip at 00:05', redo: false });
    expect(undoneStep(a, split(a, { at: 2000 }))).toBeNull();
  });
});

describe('a long recording stays light', () => {
  it('draws only the blocks in view', () => {
    let p = fromRecording({ ...rec, duration: 30 * 60_000 });
    for (let t = 10_000; t < 30 * 60_000; t += 10_000) p = split(p, { at: t });
    p = addLayer(p, { kind: 'zooms', items: [{ at: 1000, end: 2000, depth: 2, focus: 'cursor', feel: 'smooth', auto: false }] });
    const cut = currentCut(p);
    const rows = buildRows(p, cut, spans(cut), { start: 60_000, end: 120_000 });
    expect(rows[0]!.blocks.length).toBe(6);
    expect(rows.find((r) => r.key === 'zoom')!.blocks).toHaveLength(0);
    expect(rows.find((r) => r.key === 'camera')!.hint?.text).toBe(HINTS.noCamera);
  });

  it('caps thumbnails and fills the strip coarse first', () => {
    expect(thumbStep(30 * 60_000)).toBe(4500);
    expect(passOrder(5)).toEqual([0, 4, 2, 1, 3]);
  });

  it('keeps the view inside the video with readable ruler steps', () => {
    expect(clampView({ start: -500, end: 1000 }, 60_000)).toEqual({ start: 0, end: 5000 });
    expect(ticks(fitView(60_000), 600)).toEqual([0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]);
    const s = spans(currentCut(twoClips()));
    expect(pieces(s, 4000, 6000)).toEqual([{ start: 4000, end: 5000 }, { start: 5000, end: 6000 }]);
  });
});

describe('timeline labels', () => {
  it('names a multi-selection by kind, singular for one, and "items" for a mix', () => {
    expect(selectedHeader(['clip', 'clip', 'clip'])).toBe('3 clips selected');
    expect(selectedHeader(['zoom'])).toBe('1 zoom selected');
    expect(selectedHeader(['blur', 'blur'])).toBe('2 blurs selected');
    expect(selectedHeader(['text', 'blur'])).toBe('2 items selected');
    expect(selectedHeader(['arrow', 'arrow'])).toBe('2 items selected');
  });

  it('names added files Media, Media 2 and Sound, with the file name on the block', () => {
    const base = fromRecording(rec);
    const src = (id: string, video: boolean) => ({ id, kind: 'media', file: id, mime: '', offset: 0, duration: 1000, video, audio: true, name: `${id}.file` });
    const placed = (id: string) => ({ id, source: id, at: 0, trim: [0, 1000] as [number, number], volume: 1, muted: false });
    const p = { ...base, sources: [...base.sources, src('a', true), src('b', false), src('c', true)] } as unknown as Project;
    const cut = { ...currentCut(p), media: [placed('a'), placed('b'), placed('c')] };
    const media = buildRows(p, cut, spans(cut), { start: 0, end: 10_000 }).filter((r) => r.key === 'media');
    expect(media.map((r) => r.name)).toEqual(['Media', 'Sound', 'Media 2']);
    expect(media[1]!.blocks[0]!.label).toBe('b.file');
  });
});
