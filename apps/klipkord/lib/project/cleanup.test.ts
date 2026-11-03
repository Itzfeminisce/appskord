import { describe, expect, it } from 'vitest';
import type { Recording, Segment } from '../types';
import { units } from '../wordCuts';
import { currentCut, steps, undo } from './history';
import { fromRecording } from './migrate';
import { applyCleanup, DEFAULT_CLEANUP, fillerFinds, findAll, listed, pauseFinds, PAUSE_SPEED, retakeFinds, timeSaved } from './cleanup';
import { captionLines } from './captions';
import { cutRange } from './ops';
import { cutLength } from './time';
import type { Project } from './types';

/** A line of words, 500 ms each with 100 ms between, from `at`. */
function line(at: number, text: string): Segment {
  const words = text.split(' ').map((w, i) => ({ start: at + i * 600, end: at + i * 600 + 500, text: w }));
  return { start: at, end: words.at(-1)!.end, text, words };
}

const transcript: Segment[] = [
  line(0, "Hi, I'm Sam. Um, in this video"),           // 0..3500
  line(4000, 'So first, open Settings.'),               // 4000..5300
  line(6000, 'Click Invite and type their email, uh,'),  // 6000..10100
  line(11_000, 'Click Invite and type their email address.'), // 11000..15100
  line(18_000, 'Pick a role.'),                         // pause of 2.9 s before it
];
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const all = units(transcript);

describe('clean up finds', () => {
  it('finds fillers, including a phrase-opening "so"', () => {
    const f = fillerFinds(transcript, currentCut(base()));
    expect(f.map((x) => x.text)).toEqual(['Um,', 'So', 'uh,']);
    expect(f[0]!.units).toEqual([3]);
  });

  it('skips fillers already cut', () => {
    const p = cutRange(base(), { from: 1800, to: 2300 });
    expect(fillerFinds(transcript, currentCut(p)).map((x) => x.text)).toEqual(['So', 'uh,']);
  });

  it('finds pauses longer than the setting, less the breath on each side', () => {
    const cut = currentCut(base());
    const two = pauseFinds(all, cut, 2000);
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ start: 15_100 + 300, end: 18_000 - 300, text: '2.9 s', saves: 2300 });
    expect(pauseFinds(all, cut, 1000)).toHaveLength(1);
    expect(pauseFinds(all, cut, 3000)).toHaveLength(0);
    expect(pauseFinds(all, cut, 2000, 'speed')[0]!.saves).toBeCloseTo(2300 * (1 - 1 / PAUSE_SPEED));
  });

  it('detects a retake and keeps the last try', () => {
    const r = retakeFinds(all, currentCut(base()));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'retake', start: 6000, end: 11_000, text: 'Click Invite and type their email, uh,' });
  });

  it('does not call two different sentences a retake', () => {
    const t = [line(0, 'I want to show you Settings today.'), line(5000, 'I want to explain roles next week.')];
    expect(retakeFinds(units(t), currentCut(fromRecording({ ...rec, transcript: t })))).toEqual([]);
  });

  it('does not call a similar start with a different ending a retake', () => {
    const t = [line(0, 'Click the button to save.'), line(5000, 'Click the button to export.')];
    expect(retakeFinds(units(t), currentCut(fromRecording({ ...rec, transcript: t })))).toEqual([]);
  });

  it('accepts one changed word in a long sentence, and a cut-off first try', () => {
    const long = [line(0, 'Open the settings page and click the invite button.'), line(7000, 'Open the settings page and press the invite button.')];
    expect(retakeFinds(units(long), currentCut(fromRecording({ ...rec, transcript: long })))).toHaveLength(1);
    const cutOff = [line(0, 'Click the button'), line(5000, 'Click the button to export.')];
    expect(retakeFinds(units(cutOff), currentCut(fromRecording({ ...rec, transcript: cutOff })))).toHaveLength(1);
  });

  it('honours word fixes and counts a retake once', () => {
    expect(fillerFinds(transcript, currentCut(base()), all, { 3: 'Sam' }).map((x) => x.text)).toEqual(['So', 'uh,']);
    const finds = findAll(transcript, currentCut(base()), DEFAULT_CLEANUP);
    const fillerInRetake = finds.fillers.find((f) => f.text === 'uh,')!;
    expect(timeSaved([...finds.retakes, fillerInRetake])).toBe(5000);
  });

  it('counts by kind and lists only switched-on kinds', () => {
    const finds = findAll(transcript, currentCut(base()), DEFAULT_CLEANUP);
    expect([finds.fillers.length, finds.pauses.length, finds.retakes.length]).toEqual([3, 1, 1]);
    expect(listed(finds, { ...DEFAULT_CLEANUP, retakes: false }).map((f) => f.kind)).toEqual(['filler', 'filler', 'filler', 'pause']);
    expect(timeSaved(listed(finds, DEFAULT_CLEANUP))).toBe(500 + 500 + 2300 + 5000);
  });
});

describe('segment-only transcripts (OpenAI text without word times)', () => {
  it('cleans up by whole lines and still makes captions, with no word-level finds', () => {
    const plain: Segment[] = transcript.map(({ words: _w, ...seg }) => seg);
    const p = fromRecording({ ...rec, transcript: plain });
    const finds = findAll(plain, currentCut(p), DEFAULT_CLEANUP);
    expect(finds.pauses).toHaveLength(1);
    expect(finds.fillers.every((f) => plain.some((s) => f.start >= s.start && f.end <= s.end))).toBe(true);
    expect(() => applyCleanup(p, listed(finds, DEFAULT_CLEANUP), 'cut')).not.toThrow();
    expect(captionLines(units(plain)).length).toBeGreaterThan(0);
  });
});

describe('applyCleanup', () => {
  it('cuts every chosen find as one Undo step', () => {
    const p = base();
    const finds = listed(findAll(transcript, currentCut(p), DEFAULT_CLEANUP), DEFAULT_CLEANUP);
    const next = applyCleanup(p, finds, 'cut');
    expect(steps(next).steps.map((s) => s.label)).toEqual(['Cut 5 with Clean up']);
    expect(cutLength(currentCut(next))).toBeLessThan(cutLength(currentCut(p)));
    expect(currentCut(undo(next)).clips).toEqual(currentCut(p).clips);
  });

  it('speeds pauses up instead of cutting them', () => {
    const p = base();
    const pauses = findAll(transcript, currentCut(p), DEFAULT_CLEANUP).pauses;
    const next = applyCleanup(p, pauses, 'speed');
    expect(currentCut(next).clips.filter((c) => c.speed === PAUSE_SPEED)).toHaveLength(1);
    expect(steps(next).steps).toHaveLength(1);
  });
});
