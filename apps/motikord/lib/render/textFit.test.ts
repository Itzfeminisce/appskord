import { describe, expect, it } from 'vitest';
import { fitText, wrap, type Measure } from './textFit';

// Every character is half the type size wide.
const measure: Measure = (text, size) => text.length * size * 0.5;

describe('textFit', () => {
  it('keeps the largest size when the text already fits', () => {
    const f = fitText({ text: 'Hello', width: 500, height: 200, maxSize: 100, lineHeight: 1.2, measure });
    expect(f).toEqual({ sizePx: 100, lines: ['Hello'], fits: true });
  });

  it('wraps words onto lines that fit the width', () => {
    expect(wrap('one two three', 40, 10, measure)).toEqual(['one two', 'three']);
  });

  it('shrinks to the largest size whose wrapped lines fit both ways', () => {
    const f = fitText({ text: 'Spring sale now on', width: 300, height: 100, maxSize: 80, lineHeight: 1, measure });
    expect(f.fits).toBe(true);
    expect(f.lines.length * f.sizePx).toBeLessThanOrEqual(100);
    for (const l of f.lines) expect(measure(l, f.sizePx)).toBeLessThanOrEqual(300);
    const bigger = fitText({ text: 'Spring sale now on', width: 300, height: 100, maxSize: f.sizePx + 1, minSize: f.sizePx + 1, lineHeight: 1, measure });
    expect(bigger.fits).toBe(false);
  });

  it('keeps line breaks and breaks a word that is wider than the box', () => {
    expect(wrap('a\nb', 100, 10, measure)).toEqual(['a', 'b']);
    expect(wrap('abcdefghij', 25, 10, measure)).toEqual(['abcde', 'fghij']);
  });

  it('reports a miss at the smallest size when nothing fits', () => {
    const f = fitText({ text: 'Too much text for a tiny box', width: 20, height: 5, maxSize: 60, minSize: 10, lineHeight: 1.2, measure });
    expect(f.fits).toBe(false);
    expect(f.sizePx).toBe(10);
  });
});
