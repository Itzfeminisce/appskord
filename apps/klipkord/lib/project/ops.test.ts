import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import type { Unit } from '../wordCuts';
import { currentCut, steps, undo } from './history';
import { fromRecording } from './migrate';
import {
  addChapter, addLayer, autoZoomed, autoZoomOnOpen, cutRange, deleteClip, deleteWords, duplicateClip, fixWord, moveRange, pasteAfter, removeChapter,
  removeLayer, restoreWords, setAudio, setCamera, setCaptions, setLook, setSpeed, setTrack, setTransition, split,
  updateChapter, updateLayer, LABELS, quote,
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
    expect(label(p)).toBe('Cut 2 words');
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
    expect(label(gap)).toBe('Deleted a clip, kept the gap');
    expect(cutLength(cut(gap))).toBe(10_000);
    expect(deleteClip(closed, { id: b!.id })).toBe(closed);
  });

  it('moves a selection and keeps edits in other cuts', () => {
    const p = moveRange(base(), { from: 2000, to: 3000, at: 8000, label: 'Moved “Then pick a…” before Members' });
    expect(label(p)).toBe('Moved “Then pick a…” before Members');
    expect(ends(p)).toEqual([[0, 2000], [3000, 8000], [2000, 3000], [8000, 10_000]]);
    expect(toOut(cut(p), 2500)).toBe(7500);
    const still = base();
    for (const at of [2000, 2500, 3000]) expect(moveRange(still, { from: 2000, to: 3000, at, label: 'x' })).toBe(still);
    const front = moveRange(base(), { from: 8000, to: 10_000, at: 0, label: 'x' });
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
    expect(label(p)).toBe('Sped up 1 pause');
    expect(label(setSpeed(b, { ids: [id], speed: 2 }))).toBe('Set speed to 2x');
  });

  it('sets and clears a transition', () => {
    const b = base();
    const id = cut(b).clips[0]!.id;
    const p = setTransition(b, { id, transition: { kind: 'fade', ms: 400 } });
    expect(label(p)).toBe('Set the transition to Cross-fade');
    const q = setTransition(p, { id });
    expect(cut(q).clips[0]!.transition).toBeUndefined();
    expect(label(q)).toBe('Set the transition to None');
  });

  it('duplicates a clip and pastes clips at a time', () => {
    const p = split(base(), { at: 5000 });
    expect(label(p)).toBe('Split a clip at 00:05');
    const [a] = cut(p).clips;
    const d = duplicateClip(p, { id: a!.id });
    expect(label(d)).toBe('Duplicated a clip');
    expect(ends(d)).toEqual([[0, 5000], [0, 5000], [5000, 10_000]]);
    expect(new Set(cut(d).clips.map((c) => c.id)).size).toBe(3);
    const pasted = pasteAfter(p, { clips: [a!], at: 7000 });
    expect(ends(pasted)).toEqual([[0, 5000], [5000, 7000], [0, 5000], [7000, 10_000]]);
    expect(label(pasted)).toBe('Pasted 1 item');
    expect(pasteAfter(p, { clips: [], at: 0 })).toBe(p);
  });
});

describe('labels', () => {
  it('quotes the first 3 words and counts in the singular for 1', () => {
    expect(quote('Pick a role for')).toBe('“Pick a role…”');
    expect(quote(' Members ')).toBe('“Members”');
    expect(LABELS.deleteWords(1)).toBe('Cut 1 word');
    expect(LABELS.aiDraft(6)).toBe('Applied AI edit · 6 changes');
    expect(LABELS.replaceAll('teh', 'the')).toBe('Replaced “teh” with “the”');
    expect(label(fixWord(base(), { index: 3, text: 'Members' }))).toBe('Fixed “Members”');
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
    expect(label(p)).toBe('Changed the zoom at 00:01');
    expect(cut(p).zooms.map((z) => z.at)).toEqual([3000, 5000]);
    p = removeLayer(p, { kind: 'zooms', ids: [id] });
    expect(label(p)).toBe('Removed a zoom');
    expect(cut(p).zooms).toHaveLength(1);
    expect(updateLayer(p, { kind: 'zooms', id: 'none', patch: { depth: 3 } })).toBe(p);

    const placed = { source: 'm', at: 0, trim: [0, 1000] as [number, number], volume: 1, muted: false };
    const named = { ...p, sources: [...p.sources, { id: 'm', kind: 'media' as const, file: 'm.mp4', mime: 'video/mp4', offset: 0, duration: 1000, video: true, audio: true, name: 'Product demo final cut.mp4' }] };
    const added: string[] = [];
    p = addLayer(named, { kind: 'layouts', items: [{ at: 0, layout: 'side', switch: 'cut' }] }); added.push(label(p)!);
    p = addLayer(p, { kind: 'overlays', items: [{ kind: 'blur', at: 0, end: 1, box: { x: 0, y: 0, w: 1, h: 1 }, motion: 'fade' }] }); added.push(label(p)!);
    p = addLayer(p, { kind: 'cards', items: [{ template: 'title-hook', at: 0, ms: 2000, slots: {}, pack: 'clean' }] }); added.push(label(p)!);
    p = addLayer(p, { kind: 'media', items: [placed] }); added.push(label(p)!);
    p = addLayer(p, { kind: 'voiceovers', items: [{ ...placed, muteOriginal: true }] }); added.push(label(p)!);
    expect(added).toEqual(['Switched to Side by side at 00:00', 'Added a blur', 'Added a title hook', 'Added “Product demo final…”', 'Recorded a voiceover']);
    const c = cut(p);
    expect([c.layouts, c.overlays, c.cards, c.media, c.voiceovers].map((l) => l.length)).toEqual([1, 1, 1, 1, 1]);
    expect(cut(removeLayer(p, { kind: 'voiceovers', ids: [c.voiceovers[0]!.id] })).voiceovers).toEqual([]);
  });

  it('adds, updates and removes chapters in time order', () => {
    let p = addChapter(base(), { chapter: { at: 5000, title: 'Roles' } });
    p = addChapter(p, { chapter: { at: 0, title: 'Intro' } });
    expect(p.chapters.map((c) => c.title)).toEqual(['Intro', 'Roles']);
    expect(label(p)).toBe('Added the chapter “Intro”');
    p = updateChapter(p, { index: 0, patch: { at: 9000 } });
    expect(label(p)).toBe('Moved the chapter “Intro”');
    expect(p.chapters.map((c) => c.title)).toEqual(['Roles', 'Intro']);
    expect(label(updateChapter(p, { index: 0, patch: { title: 'Pick a role' } }))).toBe('Renamed the chapter “Pick a role”');
    p = removeChapter(p, { index: 0 });
    expect(label(p)).toBe('Deleted the chapter “Roles”');
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
    expect(steps(p).steps.slice(1).map((s) => s.label)).toEqual(['Changed the camera', 'Changed captions', 'Changed audio', 'Hid the camera track']);
    expect(label(setLook(p, { patch: { padding: 10 } }))).toBe('Changed the frame');
    expect(steps(p).steps).toHaveLength(5);
    expect(cut(undo(p)).tracks).toEqual({});
  });
});

describe('autoZoomOnOpen', () => {
  const clicks = [{ t: 2000, type: 'click', x: 0.3, y: 0.3 }, { t: 2400, type: 'click', x: 0.31, y: 0.3 }, { t: 7000, type: 'click', x: 0.8, y: 0.7 }] as const;
  const events = [...clicks];
  const opened = (): Project => ({ ...base(), events: true });

  it('adds the zooms on the clicks as one step, with why', () => {
    const p = autoZoomOnOpen(opened(), { events, duration: 10_000 });
    expect(cut(p).zooms.map((z) => [z.auto, z.why])).toEqual([[true, '2 clicks'], [true, 'Click']]);
    expect(steps(p).steps.map((s) => s.label)).toEqual(['Added 2 zooms']);
    expect(cut(undo(p)).zooms).toEqual([]);
  });

  it('runs only on a first open with events', () => {
    const once = autoZoomOnOpen(opened(), { events });
    expect(once.options.autoZoomed).toBe(true);
    const undone = undo(once);
    expect(undone.options.autoZoomed).toBe(true);
    expect(autoZoomOnOpen(undone, { events })).toBe(undone);
    const none = base();
    expect(autoZoomOnOpen(none, { events })).toBe(none);
    const quiet = opened();
    expect(autoZoomOnOpen(quiet, { events: [] })).toBe(quiet);
    const moves = autoZoomOnOpen(opened(), { events: [{ t: 10, type: 'move', x: 0.5, y: 0.5 }] });
    expect(moves.options.autoZoomed).toBe(true);
    expect(cut(moves).zooms).toHaveLength(0);
  });

  it('still runs when the user edited before the events loaded', () => {
    const edited = setLook(opened(), { patch: { padding: 10 } });
    expect(cut(autoZoomOnOpen(edited, { events })).zooms).toHaveLength(2);
  });

  it('treats a project saved before the flag as done once it has history or zooms', () => {
    const legacy = (p: Project): Project => ({ ...p, options: { ...p.options, autoZoomed: undefined } });
    expect(autoZoomed(legacy(opened()))).toBe(false);
    const edited = legacy(setLook(opened(), { patch: { padding: 10 } }));
    expect(autoZoomOnOpen(edited, { events })).toBe(edited);
    const zoomed = legacy(addLayer(opened(), { kind: 'zooms', items: [{ at: 0, end: 1000, depth: 2, focus: 'cursor', feel: 'smooth', auto: false }] }));
    expect(autoZoomed(zoomed)).toBe(true);
  });
});
