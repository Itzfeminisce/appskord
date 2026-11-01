import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import type { Unit } from '../wordCuts';
import { currentCut, steps, undo } from './history';
import { fromRecording } from './migrate';
import {
  addChapter, addLayer, cutRange, deleteClip, deleteWords, duplicateClip, fixWord, moveRange, pasteAfter, removeChapter,
  removeLayer, restoreWords, setAudio, setCamera, setCaptions, setLook, setSpeed, setTrack, setTransition, split,
  updateChapter, updateLayer,
} from './ops';
import { cutLength, toOut } from './time';
import type { Project } from './types';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [] } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const cut = (p: Project) => currentCut(p);
const ends = (p: Project) => cut(p).clips.map((c) => [c.in, c.out]);
const label = (p: Project) => steps(p).steps.at(-1)?.label;
const units: Unit[] = ['Hi,', "I'm", 'Sam.', 'Then', 'pick', 'Members.'].map((text, i) => ({ start: i * 1000, end: i * 1000 + 600, text, line: 0 }));

describe('word ops', () => {
  it('deletes words with the pause after them and names the step', () => {
    const p = deleteWords(base(), { units, chosen: new Set([1, 2]) });
    expect(ends(p)).toEqual([[0, 1000], [2600, 10_000]]);
    expect(label(p)).toBe('Deleted 2 words');
  });

  it('joins a new deletion to words already cut', () => {
    const p = deleteWords(deleteWords(base(), { units, chosen: new Set([1]) }), { units, chosen: new Set([2]) });
    expect(ends(p)).toEqual([[0, 1000], [2600, 10_000]]);
  });

  it('never deletes every word of the picture', () => {
    const one = fromRecording({ ...rec, duration: 600 });
    expect(deleteWords(one, { units, chosen: new Set([0]) })).toBe(one);
    const p = base();
    expect(deleteWords(p, { units, chosen: new Set() })).toBe(p);
  });

  it('brings words back with the pauses to kept neighbours', () => {
    const cutP = deleteWords(base(), { units, chosen: new Set([2, 3]) });
    expect(ends(cutP)).toEqual([[0, 2000], [3600, 10_000]]);
    const back = restoreWords(cutP, { units, from: 2, to: 2 });
    expect(ends(back)).toEqual([[0, 2600], [3600, 10_000]]);
    expect(label(back)).toBe('Brought back 1 word');
    const all = restoreWords(cutP, { units, from: 2, to: 3 });
    expect(ends(all)).toEqual([[0, 3600], [3600, 10_000]]);
    expect(cutLength(cut(all))).toBe(10_000);
  });

  it('fixes and clears a word', () => {
    const p = fixWord(base(), { index: 2, text: ' Sam. ' });
    expect(p.wordFixes).toEqual({ 2: 'Sam.' });
    expect(fixWord(p, { index: 2, text: 'Sam.' })).toBe(p);
    expect(fixWord(p, { index: 2, text: '' }).wordFixes).toEqual({});
  });
});

describe('clip ops', () => {
  it('cuts a recording range or an output range', () => {
    expect(ends(cutRange(base(), { from: 2000, to: 3000 }))).toEqual([[0, 2000], [3000, 10_000]]);
    const b = base();
    const fast = setSpeed(b, { ids: [cut(b).clips[0]!.id], speed: 2 });
    const p = cutRange(fast, { from: 1000, to: 2000, time: 'out' });
    expect(ends(p)).toEqual([[0, 2000], [4000, 10_000]]);
    const whole = base();
    expect(cutRange(whole, { from: 0, to: 10_000 })).toBe(whole);
  });

  it('splits at the playhead and keeps the transition on the first half', () => {
    const b = base();
    const p0 = setTransition(b, { id: cut(b).clips[0]!.id, transition: { kind: 'fade', ms: 300 } });
    const p = split(p0, { at: 4000 });
    expect(ends(p)).toEqual([[0, 4000], [4000, 10_000]]);
    expect(cut(p).clips[0]!.transition).toEqual({ kind: 'fade', ms: 300 });
    expect(cut(p).clips[1]!.transition).toBeUndefined();
    expect(split(p, { at: 4000 })).toBe(p);
  });

  it('deletes a clip closing the gap or leaving one, never the last picture', () => {
    const p = split(base(), { at: 4000 });
    const [a, b] = cut(p).clips;
    const closed = deleteClip(p, { id: a!.id });
    expect(ends(closed)).toEqual([[4000, 10_000]]);
    const gap = deleteClip(p, { id: a!.id, leaveGap: true });
    expect(cut(gap).clips[0]).toMatchObject({ gap: true, in: 0, out: 4000 });
    expect(cutLength(cut(gap))).toBe(10_000);
    expect(deleteClip(closed, { id: b!.id })).toBe(closed);
  });

  it('moves a selection and keeps edits in other cuts', () => {
    const p = moveRange(base(), { from: 2000, to: 3000, at: 8000 });
    expect(ends(p)).toEqual([[0, 2000], [3000, 8000], [2000, 3000], [8000, 10_000]]);
    expect(toOut(cut(p), 2500)).toBe(7500);
    const still = base();
    expect(moveRange(still, { from: 2000, to: 3000, at: 2500 })).toBe(still);
    const front = moveRange(base(), { from: 8000, to: 10_000, at: 0 });
    expect(ends(front)).toEqual([[8000, 10_000], [0, 8000]]);
  });

  it('sets speed, clamped, and speeds up only the silences', () => {
    const b = base();
    const id = cut(b).clips[0]!.id;
    expect(cut(setSpeed(b, { ids: [id], speed: 9 })).clips[0]!.speed).toBe(4);
    const p = setSpeed(b, { ids: [id], speed: 2, naturalVoice: true, silences: [{ start: 2000, end: 4000 }] });
    expect(cut(p).clips.map((c) => [c.in, c.out, c.speed, c.silencesOnly, c.naturalVoice])).toEqual([
      [0, 2000, 1, true, true], [2000, 4000, 2, true, true], [4000, 10_000, 1, true, true],
    ]);
    expect(cutLength(cut(p))).toBe(9000);
    expect(label(p)).toBe('Set speed to 2x');
  });

  it('sets and clears a transition', () => {
    const b = base();
    const id = cut(b).clips[0]!.id;
    const p = setTransition(b, { id, transition: { kind: 'zoom', ms: 400 } });
    expect(cut(setTransition(p, { id })).clips[0]!.transition).toBeUndefined();
  });

  it('duplicates a clip and pastes clips at a time', () => {
    const p = split(base(), { at: 5000 });
    const [a] = cut(p).clips;
    const d = duplicateClip(p, { id: a!.id });
    expect(ends(d)).toEqual([[0, 5000], [0, 5000], [5000, 10_000]]);
    expect(new Set(cut(d).clips.map((c) => c.id)).size).toBe(3);
    const pasted = pasteAfter(p, { clips: [a!], at: 7000 });
    expect(ends(pasted)).toEqual([[0, 5000], [5000, 7000], [0, 5000], [7000, 10_000]]);
    expect(pasteAfter(p, { clips: [], at: 0 })).toBe(p);
  });
});

describe('layer and setting ops', () => {
  it('adds, updates and removes every layer kind, sorted by time', () => {
    const zooms = [3000, 1000].map((at) => ({ at, end: at + 1000, depth: 2, focus: 'cursor' as const, feel: 'smooth' as const, auto: true }));
    let p = addLayer(base(), { kind: 'zooms', items: zooms });
    expect(label(p)).toBe('Added 2 zooms');
    expect(cut(p).zooms.map((z) => z.at)).toEqual([1000, 3000]);
    const id = cut(p).zooms[0]!.id;
    p = updateLayer(p, { kind: 'zooms', id, patch: { at: 5000, end: 6000 } });
    expect(cut(p).zooms.map((z) => z.at)).toEqual([3000, 5000]);
    p = removeLayer(p, { kind: 'zooms', ids: [id] });
    expect(cut(p).zooms).toHaveLength(1);
    expect(updateLayer(p, { kind: 'zooms', id: 'none', patch: { depth: 3 } })).toBe(p);

    const placed = { source: 'm', at: 0, trim: [0, 1000] as [number, number], volume: 1, muted: false };
    p = addLayer(p, { kind: 'layouts', items: [{ at: 0, layout: 'side', switch: 'cut' }] });
    p = addLayer(p, { kind: 'overlays', items: [{ kind: 'text', at: 0, end: 1, box: { x: 0, y: 0, w: 1, h: 1 }, text: 'Hi', motion: 'fade' }] });
    p = addLayer(p, { kind: 'cards', items: [{ template: 'title', at: 0, ms: 2000, slots: {}, pack: 'clean' }] });
    p = addLayer(p, { kind: 'media', items: [placed] });
    p = addLayer(p, { kind: 'voiceovers', items: [{ ...placed, muteOriginal: true }] });
    const c = cut(p);
    expect([c.layouts, c.overlays, c.cards, c.media, c.voiceovers].map((l) => l.length)).toEqual([1, 1, 1, 1, 1]);
    expect(cut(removeLayer(p, { kind: 'voiceovers', ids: [c.voiceovers[0]!.id] })).voiceovers).toEqual([]);
  });

  it('adds, updates and removes chapters in time order', () => {
    let p = addChapter(base(), { chapter: { at: 5000, title: 'Roles' } });
    p = addChapter(p, { chapter: { at: 0, title: 'Intro' } });
    expect(p.chapters.map((c) => c.title)).toEqual(['Intro', 'Roles']);
    p = updateChapter(p, { index: 0, patch: { at: 9000 } });
    expect(p.chapters.map((c) => c.title)).toEqual(['Roles', 'Intro']);
    p = removeChapter(p, { index: 0 });
    expect(p.chapters).toEqual([{ at: 9000, title: 'Intro' }]);
    expect(removeChapter(p, { index: 5 })).toBe(p);
  });

  it('sets look, camera, captions, audio and tracks with a caller label', () => {
    let p = setLook(base(), { patch: { background: { kind: 'gradient', value: 'ember' } }, label: 'Changed background to Ember' });
    expect(label(p)).toBe('Changed background to Ember');
    p = setCamera(p, { patch: { mirror: true } });
    p = setCaptions(p, { patch: { style: 'word', show: true } });
    p = setAudio(p, { patch: { denoise: true } });
    p = setTrack(p, { name: 'camera', patch: { hidden: true } });
    const c = cut(p);
    expect([c.look.background.value, c.camera.mirror, c.captions.style, c.audio.denoise, c.tracks.camera]).toEqual(['ember', true, 'word', true, { hidden: true }]);
    expect(steps(p).steps).toHaveLength(5);
    expect(cut(undo(p)).tracks).toEqual({});
  });
});
