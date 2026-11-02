import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { estimateFor } from '../lib/render/textFit';
import { beatPreview, previewLines, ScenePreview } from './makeParts';

// Each line the card draws, in order: every whole-line span's text.
const linesOf = (html: string) => [...html.matchAll(/white-space:nowrap">([^<]*)</g)].map((m) => m[1]!).filter(Boolean);

describe('ScenePreview', () => {
  const recipe = beatPreview({ template: 'list', line: 'classic, rye and seeded', ms: 3000 }, 'bold', '9:16', 'Our loaves')!;
  const html = renderToStaticMarkup(<ScenePreview recipe={recipe} index={0} width={96} height={170} />);
  it('draws the scene as a readable card: kicker, heavy headline and marked items', () => {
    expect(linesOf(html)).toEqual(['List', 'Our', 'loaves', 'Classic', 'Rye', 'Seeded']);
    expect(html).toContain('font-size:15px');
    expect(html).not.toContain('<canvas');
    expect(html).not.toContain('overflow-wrap');
  });
  it('shows the bold pack as a thin footer band, not a slab', () => {
    expect(html).toMatch(/bottom:0;height:22px;background:#FACC15/);
  });
  it('numbers the items on a Steps scene', () => {
    const steps = beatPreview({ template: 'steps', line: 'pick loaves, choose a time and collect warm', ms: 3000 }, 'bold', '9:16', 'Order ahead')!;
    const out = renderToStaticMarkup(<ScenePreview recipe={steps} index={0} width={44} height={78} />);
    expect(linesOf(out)).toEqual(['Order', 'ahead']);
    expect(out).not.toContain('<canvas');
  });
  it('never splits a word in a 44 by 78 thumbnail: the headline shrinks until its longest word fits', () => {
    for (const title of ['Fresh sourdough', 'Crackling crust']) {
      const r = beatPreview({ template: 'title-hook', line: title, ms: 3000 }, 'bold', '9:16')!;
      const out = renderToStaticMarkup(<ScenePreview recipe={r} index={0} width={44} height={78} />);
      const lines = linesOf(out);
      expect(lines.join(' ')).toBe(title);
      const size = Number(/font-size:([\d.]+)px;line-height:0\.98/.exec(out)![1]);
      expect(size).toBeLessThan(13 * 44 / 96);
      const measure = estimateFor('Archivo Black', -0.01);
      for (const l of lines) expect(measure(l.toUpperCase(), size)).toBeLessThanOrEqual(44 - 18 * 44 / 96);
    }
  });
  it('shows whole words on the 96px items, cutting only after a whole word', () => {
    const r = beatPreview({ template: 'steps', line: 'pick loaves, choose a time and collect warm', ms: 3000 }, 'bold', '9:16', 'Fresh sourdough')!;
    const lines = linesOf(renderToStaticMarkup(<ScenePreview recipe={r} index={0} width={96} height={170} />));
    expect(lines).toEqual(['Steps', 'Fresh', 'sourdough', 'Pick loaves', 'Choose a time', 'Collect warm']);
    const long = beatPreview({ template: 'steps', line: 'pick loaves, choose a time for pickup and collect them warm', ms: 3000 }, 'bold', '9:16', 'x')!;
    const items = long.scenes[0]!.slots!.steps as string[];
    const shown = linesOf(renderToStaticMarkup(<ScenePreview recipe={long} index={0} width={96} height={170} />)).slice(-items.length);
    shown.forEach((l, i) => {
      expect(l).not.toMatch(/ (a|and|the)…$/);
      const words = l.replace(/…$/, '').split(' ');
      expect(items[i]!.split(' ').slice(0, words.length)).toEqual(words);
    });
  });
});

describe('previewLines', () => {
  const m = estimateFor();
  it('wraps only at spaces and shrinks so the longest word fits', () => {
    const r = previewLines('Fresh sourdough loaves', { width: 40, size: 15, maxLines: 4, measure: m });
    expect(r.lines.join(' ')).toBe('Fresh sourdough loaves');
    expect(r.size).toBeCloseTo(40 / m('sourdough', 1));
    for (const l of r.lines) expect(m(l, r.size)).toBeLessThanOrEqual(40.001);
  });
  it('caps the lines and ends the last on a whole word and an ellipsis', () => {
    const r = previewLines('one two three four five six seven eight', { width: 30, size: 10, maxLines: 2, measure: m });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]).toMatch(/^[a-z ]+…$/);
    expect('one two three four five six seven eight'.startsWith(r.lines.join(' ').replace('…', ''))).toBe(true);
  });
  it('fits a one-line item whole by shrinking, else drops words without ending on "a"', () => {
    expect(previewLines('Choose a time', { width: 60, size: 10, minSize: 8, maxLines: 1, measure: m }).lines).toEqual(['Choose a time']);
    expect(previewLines('Choose a time and collect it warm', { width: 40, size: 10, minSize: 8, maxLines: 1, measure: m }).lines).toEqual(['Choose…']);
  });
});
