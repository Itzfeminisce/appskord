import { describe, expect, it } from 'vitest';
import type { Change, PatchOp } from '../types';
import { record, undo, type History } from './history';
import { devSampleRecipe } from './store';
import { newLook } from './v2';
import { agoLabel, byLabel, madeBy, madeState, madeSummary, describe as describeChange, madeLine, metaLine, newestFirst, promptSummary, sceneOf, splitSummary, statesAfter, stepsBack, whenLabel, whoLabel } from './changes';

const r0 = devSampleRecipe('c');
const size = (v: number): PatchOp[] => [{ op: 'replace', path: '/scenes/0/layers/2/sizePx', value: v }];

function threeChanges() {
  let doc = r0;
  let h: History = { past: [], future: [] };
  const steps: [PatchOp[], Change['by'], number][] = [
    [size(80), 'hand', 1000],
    [[{ op: 'replace', path: '/scenes/1/durationMs', value: 6000 }, { op: 'replace', path: '/scenes/1/layers/1/endMs', value: 6000 }], 'groq', 5000],
    [[{ op: 'replace', path: '/scenes/0/layers/2/in', value: { preset: 'pop-in', feel: 'bouncy', durationMs: 500 } }], 'builtin', 9000],
  ];
  const docs = [doc];
  for (const [ops, by, at] of steps) {
    ({ doc, history: h } = record(doc, h, ops, { by, at, id: `c${at}`, summary: `s${at}` }));
    docs.push(doc);
  }
  return { doc, h, docs };
}

describe('changes', () => {
  it('labels every provider author', () => {
    expect(['groq', 'openai', 'anthropic', 'openrouter', 'google', 'xai'].map((b) => byLabel(b as never))).toEqual(['Groq', 'OpenAI', 'Anthropic', 'OpenRouter', 'Gemini', 'xAI']);
  });
  it('lists newest first with time and author', () => {
    const { h } = threeChanges();
    const list = newestFirst(h.past);
    expect(list.map((c) => c.id)).toEqual(['c9000', 'c5000', 'c1000']);
    expect(metaLine(list[0]!, 9000 + 20_000)).toBe('Just now · built-in AI');
    expect(metaLine(list[1]!, 5000 + 180_000)).toBe('3 min ago · Groq');
    expect(metaLine(list[2]!, 1000 + 60_000)).toBe('1 min ago · by hand');
    expect(agoLabel(0, 59_999)).toBe('Just now');
  });

  it('Undo takes back the newest change only', () => {
    const { doc, h, docs } = threeChanges();
    const out = undo(doc, h);
    expect(out.doc).toEqual(docs[2]);
    expect(out.history.past.map((c) => c.id)).toEqual(['c1000', 'c5000']);
  });

  it('Go back here undoes every change after it, and Redo can bring them back', () => {
    const { doc, h, docs } = threeChanges();
    const n = stepsBack(h.past, 'c1000')!;
    expect(n).toBe(2);
    let d = doc;
    let hh = h;
    for (let i = 0; i < n; i++) ({ doc: d, history: hh } = undo(d, hh));
    expect(d).toEqual(docs[1]);
    expect(hh.past.map((c) => c.id)).toEqual(['c1000']);
    expect(hh.future).toHaveLength(2);
    expect(stepsBack(h.past, 'c9000')).toBe(0);
    expect(stepsBack(h.past, 'nope')).toBeUndefined();
  });

  it('stores a prompt change as its words and what it did', () => {
    const s = promptSummary(' Slower ', 'Clip is now 16 s.');
    expect(s).toBe('“Slower”\nClip is now 16 s.');
    expect(splitSummary(s)).toEqual({ title: '“Slower”', detail: 'Clip is now 16 s.' });
    expect(splitSummary('Title rotated')).toEqual({ title: 'Title rotated' });
  });

  it('describes preset and length changes', () => {
    const { docs } = threeChanges();
    expect(describeChange(docs[1]!, docs[2]!)).toBe('Clip is now 16 s.');
    expect(describeChange(docs[2]!, docs[3]!)).toBe('Title: Rise → Pop.');
  });
});

describe('changes v2', () => {
  it('names who and when as ChangesV2 does', () => {
    expect(['hand', 'groq', 'check', 'template'].map((b) => whoLabel(b as Change['by']))).toEqual(['You', 'Groq', 'Quality check', undefined]);
    expect(whenLabel(1000, 30_000)).toBe('now');
    expect(whenLabel(0, 120_000)).toBe('2 min ago');
    expect(madeLine({ ...r0, pace: 'normal' }, 'Bold')).toBe('3 scenes, Bold, Normal pace');
  });

  it('names who made the clip on "Clip made"', () => {
    expect(madeBy({ ...r0, prompt: undefined }, null)).toBe('You');
    expect(madeBy({ ...r0, prompt: 'Launch day' }, { ai: 'cloud', provider: 'groq' })).toBe('Groq');
    expect(madeBy({ ...r0, prompt: 'Launch day' }, { ai: 'local', provider: 'groq' })).toBe('Built-in AI');
  });

  it('gives the clip just after each change, newest first, for thumbnails', () => {
    const { doc, h, docs } = threeChanges();
    expect(statesAfter(doc, h.past)).toEqual([docs[3], docs[2], docs[1]]);
    expect(sceneOf(h.past[1]!)).toBe(1);
    expect(madeState(doc, h.past)).toEqual(docs[0]);
  });

  it('describes "Clip made" as it was made, not in a look applied later', () => {
    const made = { ...r0, style: 'bold' as const, pace: 'normal' as const };
    const look = newLook(made, 'playful', 'calm');
    const { doc, history } = record(made, { past: [], future: [] }, look.ops, { by: 'hand', at: 1000, id: 'c1', summary: look.summary });
    expect(doc.style).toBe('playful');
    expect(madeSummary(doc, history.past)).toBe(`${made.scenes.length} scenes, Bold, Normal pace`);
    expect(madeSummary(made, [])).toBe(`${made.scenes.length} scenes, Bold, Normal pace`);
  });
});
