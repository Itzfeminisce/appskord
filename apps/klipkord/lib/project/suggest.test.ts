import { describe, expect, it } from 'vitest';
import type { Recording, Segment } from '../types';
import { currentCut, steps, undo } from './history';
import { fromRecording } from './migrate';
import { applyWin, applyWins, lengths, quickWins, secs, seeQuickWins } from './suggest';
import type { Project, RecEvent } from './types';

function line(at: number, text: string): Segment {
  const words = text.split(' ').map((w, i) => ({ start: at + i * 600, end: at + i * 600 + 500, text: w }));
  return { start: at, end: words.at(-1)!.end, text, words };
}

const transcript: Segment[] = [
  line(0, "Um, I'm Sam."),
  line(3000, 'Click Invite and type their email, uh,'),
  line(9000, 'Click Invite and type their email address.'),
  line(16_000, 'Pick a role.'),
];
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const clicks: RecEvent[] = [{ t: 2000, type: 'click', x: 0.2, y: 0.2 }, { t: 12_000, type: 'click', x: 0.8, y: 0.7 }];

describe('quick wins', () => {
  it('finds fillers, each retake, long pauses and zooms on clicks', () => {
    const wins = quickWins(base(), transcript, clicks, 20_000);
    expect(wins.map((w) => w.title)).toEqual(['Remove 1 filler word', 'Cut a 6 s retake', 'Speed up 1 long pause', 'Add 2 zooms on your clicks']);
    expect(wins[0]!.detail).toBe('Um · saves 0.5 s');
    expect(wins[1]!.detail).toBe('You said “Click Invite…” twice. Keeps the last.');
    expect(wins[2]!.detail).toMatch(/^Plays them at 4x instead of cutting · saves /);
    expect(wins[3]!.detail).toMatch(/^Smooth, \d(\.\d)?x$/);
  });

  it('leaves out zooms without an events track or once auto zooms exist', () => {
    expect(quickWins(base(), transcript).map((w) => w.kind)).not.toContain('zooms');
    const zoomed = applyWin(base(), quickWins(base(), transcript, clicks)[3]!);
    expect(quickWins(zoomed, transcript, clicks).map((w) => w.kind)).not.toContain('zooms');
  });

  it('applies one win as one named step and drops it from the list', () => {
    const p = base();
    const win = quickWins(p, transcript)[0]!;
    const next = applyWin(p, win);
    expect(steps(next).steps.map((s) => s.label)).toEqual(['Applied “Remove 1 filler…”']);
    expect(quickWins(next, transcript).map((w) => w.kind)).not.toContain('fillers');
  });

  it('applies all as one Undo step and reports before and after', () => {
    const p = base();
    const wins = quickWins(p, transcript, clicks);
    const { before, after } = lengths(p, wins);
    const next = applyWins(p, wins);
    expect(steps(next).steps.map((s) => s.label)).toEqual(['Applied 4 quick wins']);
    expect(after).toBeLessThan(before);
    expect(currentCut(next).zooms).toHaveLength(2);
    expect(currentCut(undo(next))).toEqual(currentCut(p));
  });

  it('marks the quick wins seen', () => {
    expect(seeQuickWins(base()).quickWins).toBe('seen');
  });

  it('writes short times with a decimal', () => {
    expect([secs(400), secs(9000), secs(22_400)]).toEqual(['0.4 s', '9 s', '22 s']);
  });
});
