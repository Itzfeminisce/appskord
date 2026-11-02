import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import { currentCut, steps, undo } from './history';
import {
  addMedia, addMusic, addVoiceover, formatOf, IMAGE_MS, mediaSource, meterBars, OPEN_RANGE_MS, placeAt, takeEnd, takeNumber, takePieces, takesOver, voiceRange,
} from './media';
import { fromRecording } from './migrate';
import { split } from './ops';
import type { Project } from './types';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [] } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const cut = (p: Project) => currentCut(p);
const probed = { duration: 3200.4, video: true, audio: true, width: 640, height: 360 };
const clip = (id: string) => mediaSource({ id, kind: 'media', file: `media-${id}.mp4`, mime: 'video/mp4', name: 'clip.mp4', probed });
const take = (id: string, ms = 2000) => mediaSource({ id, kind: 'voiceover', file: `voiceover-${id}.webm`, mime: 'audio/webm', name: `Take ${id}`, probed: { duration: ms, video: false, audio: true } });

describe('format checks', () => {
  it('takes the frame\'s formats by extension, any case', () => {
    expect(formatOf('a.MP4')).toMatchObject({ kind: 'video', mime: 'video/mp4' });
    expect(formatOf('pic.jpg')?.kind).toBe('image');
    expect(formatOf('pic.jpeg')?.kind).toBe('image');
    expect(formatOf('song.m4a')?.kind).toBe('sound');
    for (const n of ['mov', 'webm', 'png', 'gif', 'mp3', 'wav']) expect(formatOf(`x.${n}`)).not.toBeNull();
  });
  it('refuses the rest (import-unsupported) and files with no extension', () => {
    expect(formatOf('clip.mkv')).toBeNull();
    expect(formatOf('clip.avi')).toBeNull();
    expect(formatOf('README')).toBeNull();
  });
});

describe('sources', () => {
  it('gives an image five seconds and no sound', () => {
    const s = mediaSource({ id: 'i', kind: 'media', file: 'media-i.png', mime: 'image/png', name: 'a.png', probed: { duration: 0, width: 10, height: 10, video: false, audio: false } });
    expect(s).toMatchObject({ duration: IMAGE_MS, video: true, audio: false, offset: 0 });
  });
  it('rounds a video\'s length to ms', () => expect(clip('v').duration).toBe(3200));
});

describe('placement', () => {
  it('maps the playhead through cuts and speed into recording time', () => {
    let p = split(base(), { at: 4000 });
    p = { ...p, cuts: p.cuts.map((c) => ({ ...c, clips: [c.clips[0]!, { ...c.clips[1]!, in: 6000 }] })) };
    expect(placeAt(cut(p), 2000, 10_000)).toBe(2000);
    expect(placeAt(cut(p), 5000, 10_000)).toBe(7000);
  });
  it('stays inside the recording at the very end', () => {
    expect(placeAt(cut(base()), 99_999, 10_000)).toBeLessThanOrEqual(10_000);
    expect(placeAt(cut(base()), -5, 10_000)).toBe(0);
  });
});

describe('addMedia', () => {
  it('adds the source and a placement as one Undo step with the file name', () => {
    const p = addMedia(base(), { source: clip('v'), at: 2500 });
    expect(p.sources.map((s) => s.id)).toContain('v');
    expect(cut(p).media).toMatchObject([{ source: 'v', at: 2500, trim: [0, 3200], volume: 1, muted: false }]);
    expect(steps(p).steps.at(-1)?.label).toBe('Added “clip.mp4”');
    expect(cut(undo(p)).media).toEqual([]);
  });
  it('keeps media in order of time', () => {
    const p = addMedia(addMedia(base(), { source: clip('a'), at: 5000 }), { source: clip('b'), at: 1000 });
    expect(cut(p).media.map((m) => m.source)).toEqual(['b', 'a']);
  });
  it('sets music, keeping the settings already there', () => {
    const music = mediaSource({ id: 'm', kind: 'music', file: 'music-m.m4a', mime: 'audio/mp4', name: 'Slow tide', probed: { duration: 90_000, video: false, audio: true } });
    const p = addMusic(base(), { source: music });
    expect(cut(p).audio.music).toMatchObject({ source: 'm', volume: 0.3, duck: true });
    const q = addMusic({ ...p, cuts: p.cuts.map((c) => ({ ...c, audio: { ...c.audio, music: { ...c.audio.music!, volume: 0.6, duck: false } } })) }, { source: { ...music, id: 'n' } });
    expect(cut(q).audio.music).toMatchObject({ source: 'n', volume: 0.6, duck: false });
  });
});

describe('voiceover takes', () => {
  it('places a take that mutes the original voice, one step', () => {
    const p = addVoiceover(base(), { source: take('t1'), at: 1000 });
    expect(cut(p).voiceovers).toMatchObject([{ source: 't1', at: 1000, trim: [0, 2000], muteOriginal: true, muted: false }]);
    expect(steps(p).steps.at(-1)?.label).toBe('Recorded a voiceover');
    expect(cut(undo(p)).voiceovers).toEqual([]);
  });
  it('can leave the original voice playing', () => {
    expect(cut(addVoiceover(base(), { source: take('t1'), at: 0, muteOriginal: false })).voiceovers[0]!.muteOriginal).toBe(false);
  });
  it('keeps every take and silences the older ones mostly under a new one', () => {
    let p = addVoiceover(base(), { source: take('t1'), at: 1000 });
    p = addVoiceover(p, { source: take('t2', 1800), at: 1200 });
    p = addVoiceover(p, { source: take('t3'), at: 8000 });
    const v = cut(p).voiceovers;
    expect(v).toHaveLength(3);
    expect(v.map((x) => [x.source, x.muted])).toEqual([['t1', true], ['t2', false], ['t3', false]]);
  });
  it('mutes only the part of an earlier take a new one covers', () => {
    let p = addVoiceover(base(), { source: take('t1', 4000), at: 1000 });
    p = addVoiceover(p, { source: take('t2', 1000), at: 2000 });
    expect(cut(p).voiceovers.map((x) => [x.source, x.at, x.trim, x.muted])).toEqual([
      ['t1', 1000, [0, 1000], false], ['t2', 2000, [0, 1000], false], ['t1', 2000, [1000, 2000], true], ['t1', 3000, [2000, 4000], false],
    ]);
    expect(cut(undo(p)).voiceovers).toHaveLength(1);
  });
  it('marks a take for clean and level on its own, leaving the project mix alone', () => {
    const p = addVoiceover(base(), { source: take('t1'), at: 0, clean: true });
    expect(cut(p).voiceovers[0]!.clean).toBe(true);
    expect(cut(p).audio).toMatchObject({ denoise: false, level: false });
  });
  it('numbers takes by place among those over the same spot', () => {
    let p = addVoiceover(base(), { source: take('t1'), at: 1000 });
    p = addVoiceover(p, { source: take('t2'), at: 1200 });
    p = addVoiceover(p, { source: take('t3'), at: 8000 });
    const [a, b, c] = cut(p).voiceovers;
    expect([takeNumber(p, a!), takeNumber(p, b!), takeNumber(p, c!)]).toEqual([1, 2, 1]);
    expect(takesOver(p, a!).map((x) => x.source)).toEqual(['t1', 't2']);
  });
});

describe('voiceRange', () => {
  const transcript = [{ start: 0, end: 4000, text: 'a' }, { start: 4500, end: 9000, text: 'b' }];
  it('runs from the playhead to the end of the sentence being said', () => {
    expect(voiceRange(cut(base()), { out: 1000, selectedClips: [], transcript })).toEqual({ startOut: 1000, endOut: 3999 });
  });
  it('takes the next sentence when the playhead is past the end of one', () => {
    expect(voiceRange(cut(base()), { out: 4200, selectedClips: [], transcript }).endOut).toBe(8999);
  });
  it('uses the selected clips when there are some', () => {
    const p = split(base(), { at: 5000 });
    const [a, b] = cut(p).clips;
    expect(voiceRange(cut(p), { out: 0, selectedClips: [b!.id], transcript })).toEqual({ startOut: 5000, endOut: 10_000 });
    expect(a).toBeDefined();
  });
  it('falls back to ten seconds or the cut\'s end without a transcript', () => {
    expect(voiceRange(cut(base()), { out: 0, selectedClips: [], transcript: [] }).endOut).toBe(OPEN_RANGE_MS);
    expect(voiceRange(cut(base()), { out: 6000, selectedClips: [], transcript: [] }).endOut).toBe(10_000);
  });
});

describe('meterBars', () => {
  it('scales seven bars with the level and never below 3 px', () => {
    expect(meterBars(0)).toEqual([3, 3, 3, 3, 3, 3, 3]);
    expect(meterBars(1)).toHaveLength(7);
    expect(Math.max(...meterBars(1))).toBe(16);
    expect(meterBars(9)).toEqual(meterBars(1));
  });
});

describe('takes said across cuts and speed', () => {
  it('splits a take over a cut into pieces anchored where each was said', () => {
    // Output 0..2000 is rec 0..2000, then rec 5000..10000 follows the cut.
    const c = { ...cut(base()), clips: [{ id: 'a', in: 0, out: 2000, speed: 1 }, { id: 'b', in: 5000, out: 10_000, speed: 1 }] };
    expect(takePieces(c, 1500, 3000, 40)).toEqual([{ at: 1500, trim: [40, 540] }, { at: 5000, trim: [540, 1540] }]);
  });
  it('anchors a piece in a 2x clip at its recording time and lets it cover twice its length', () => {
    const c = { ...cut(base()), clips: [{ id: 'a', in: 0, out: 2000, speed: 1 }, { id: 'b', in: 2000, out: 10_000, speed: 2 }] };
    const pieces = takePieces(c, 1000, 4000);
    expect(pieces).toEqual([{ at: 1000, trim: [0, 1000] }, { at: 2000, trim: [1000, 3000] }]);
    const placed = { id: 'x', source: 's', volume: 1, muted: false, ...pieces[1]! };
    expect(takeEnd(c, placed)).toBe(6000);
  });
  it('leaves out what was said over a gap', () => {
    const c = { ...cut(base()), clips: [{ id: 'a', in: 0, out: 1000, speed: 1 }, { id: 'g', in: 0, out: 1000, speed: 1, gap: true }, { id: 'b', in: 3000, out: 5000, speed: 1 }] };
    expect(takePieces(c, 500, 2500)).toEqual([{ at: 500, trim: [0, 500] }, { at: 3000, trim: [1500, 2000] }]);
  });
  it('adds every piece as one Undo step', () => {
    const p = addVoiceover(base(), { source: take('t1', 1540), pieces: [{ at: 1500, trim: [40, 540] }, { at: 5000, trim: [540, 1540] }], id: 'first' });
    expect(cut(p).voiceovers.map((x) => [x.at, x.trim])).toEqual([[1500, [40, 540]], [5000, [540, 1540]]]);
    expect(cut(p).voiceovers[0]!.id).toBe('first');
    expect(cut(undo(p)).voiceovers).toEqual([]);
  });
});
