import { describe, expect, it } from 'vitest';
import type { Unit } from '../wordCuts';
import { captionAt, captionFile, captionLines, cutCues, LINE_CHARS, wrap } from './captions';
import type { Clip, Cut } from './types';

const unitsOf = (text: string, startAt = 0, step = 300): Unit[] =>
  text.split(' ').map((t, i) => ({ start: startAt + i * step, end: startAt + i * step + 250, text: t, line: 0 }));
const cut = (clips: Clip[]) => ({ clips }) as Cut;

describe('captions', () => {
  it('breaks at sentence ends and keeps the fixed text', () => {
    const units = unitsOf('Hi, I\'m Sam. Then pick a role.');
    const lines = captionLines(units, { 2: 'Sam!' });
    expect(lines.map((l) => l.text)).toEqual(["Hi, I'm Sam!", 'Then pick a role.']);
    expect(lines[0]).toMatchObject({ start: 0, end: 850 });
    expect(lines[1]!.words.map((w) => w.index)).toEqual([3, 4, 5, 6]);
  });

  it('breaks at pauses', () => {
    const units = [...unitsOf('Open the menu', 0), ...unitsOf('click Invite', 3000)];
    expect(captionLines(units).map((l) => l.text)).toEqual(['Open the menu', 'click Invite']);
  });

  it('keeps at most two lines of about 42 characters', () => {
    const units = unitsOf(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '));
    const lines = captionLines(units);
    for (const l of lines) {
      const rows = l.text.split('\n');
      expect(rows.length).toBeLessThanOrEqual(2);
      for (const r of rows) expect(r.length).toBeLessThanOrEqual(LINE_CHARS);
    }
    expect(lines.flatMap((l) => l.words).length).toBe(40);
    expect(wrap(['a'.repeat(50), 'b'])).toEqual(['a'.repeat(50), 'b']);
  });

  it('shares a line without word timings out by length', () => {
    const lines = captionLines([{ start: 0, end: 1000, text: 'ab abc. ab', line: 0 }]);
    expect(lines.map((l) => [l.text, l.start, Math.round(l.end)])).toEqual([['ab abc.', 0, 750], ['ab', 750, 1000]]);
  });

  it('places captions on a cut, drops cut words and uses a translation', () => {
    const units = unitsOf('Hi, I\'m Sam. Then pick a role.');
    const lines = captionLines(units);
    // Keeps 0..600 (Hi, I'm) and 900.. at 2x; Sam. (600..850) is cut.
    const c = cut([{ id: 'a', in: 0, out: 600, speed: 1 }, { id: 'b', in: 900, out: 3000, speed: 2 }]);
    const cues = cutCues(c, lines);
    expect(cues.map((q) => q.text)).toEqual(["Hi, I'm", 'Then pick a role.']);
    expect(cues[1]).toMatchObject({ start: 600 });
    expect(cues[1]!.end).toBe(600 + (2050 - 1 - 900) / 2 + 1);
    expect(cutCues(c, lines, ['Hola, soy Sam.', 'Elige un rol.']).map((q) => q.text)).toEqual(['Hola, soy Sam.', 'Elige un rol.']);
    expect(captionFile(c, lines, 'srt')).toContain("1\n00:00:00,000 --> 00:00:00,550\nHi, I'm\n");
    expect(captionFile(c, lines, 'vtt').startsWith('WEBVTT\n\n00:00:00.000 --> ')).toBe(true);
    expect(captionAt(lines, 1000)?.text).toBe('Then pick a role.');
    expect(captionAt(lines, 5000)).toBeUndefined();
  });
});
