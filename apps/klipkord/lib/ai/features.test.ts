import { describe, expect, it, vi } from 'vitest';
import { currentCut, steps, undo } from '../project/history';
import { fromRecording } from '../project/migrate';
import type { Project } from '../project/types';
import type { Recording } from '../types';
import type { Unit } from '../wordCuts';
import { discardHighlight, highlightFacts, makeHighlight } from './highlight';
import type { Call } from './ops';
import { aiWins } from './suggest';
import { MAX_CALL_TOKENS, tokens } from './prompt';
import { checkLines, lineBudget, lineChunks, saveTranslation, translateLines } from './translate';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [] } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const units: Unit[] = ['Hi,', "I'm", 'Sam.', 'Um,', 'then', 'pick', 'Members.'].map((text, i) => ({ start: i * 1000, end: i * 1000 + 600, text, line: 0 }));
const answer = (...bodies: unknown[]): Call => {
  const queue = bodies.map((b) => JSON.stringify(b));
  return vi.fn(async () => queue.shift() ?? '{}');
};

describe('highlights', () => {
  const checked = { ops: [{ op: 'newCut' as const, name: 'LinkedIn 30s', shape: '1:1' as const, keep: [{ from: 0, to: 2 }, { from: 5, to: 6 }] }, { op: 'caption' as const, style: 'word' as const }] };

  it('makes a new current cut of the kept words, leaving the old cut unchanged', () => {
    const p = base();
    const full = currentCut(p);
    const h = makeHighlight(p, units, checked);
    const cut = currentCut(h);
    expect(cut).toMatchObject({ name: 'LinkedIn 30s', shape: '1:1', made: 'highlight', captions: { style: 'word', show: true } });
    expect(cut.clips.map((c) => [c.in, c.out])).toEqual([[0, 2600], [5000, 6600]]);
    expect(h.cuts.find((c) => c.id === full.id)).toEqual(full);
    expect(steps(h).steps.map((s) => s.label)).toEqual(['Made the cut “LinkedIn 30s”']);
    expect(highlightFacts(h)).toEqual({ length: 4200, starts: [0, 2600] });
    expect(currentCut(undo(h)).clips).toHaveLength(1);
  });

  it('Discard removes the cut and goes back', () => {
    const p = base();
    const h = makeHighlight(p, units, checked);
    const back = discardHighlight(h, { id: h.current, back: p.current });
    expect(back.cuts).toHaveLength(1);
    expect(back.current).toBe(p.current);
  });
});

describe('translate', () => {
  it('checks the line count and repairs once', async () => {
    expect(checkLines({ lines: ['a'] }, 2).problem).toMatch(/exactly 2/);
    const call = answer({ lines: ['Hola'] }, { lines: ['Hola', 'Luego'] });
    expect(await translateLines(['Hi', 'Then'], 'Spanish', call)).toEqual(['Hola', 'Luego']);
    expect(call).toHaveBeenCalledTimes(2);
    await expect(translateLines(['Hi'], 'Spanish', answer({}, {}))).rejects.toMatchObject({ code: 'failed' });
  });

  it('splits long captions into calls under the budget', () => {
    const lines = Array.from({ length: 400 }, () => 'A caption line of about forty characters!');
    expect(lineChunks(lines).length).toBeGreaterThan(1);
  });

  it('keeps every call, repair included, under 8,000 tokens for every script on a 30-minute video', async () => {
    const lines = Array.from({ length: 640 }, (_, i) => `Line ${i}: then open the workspace settings and pick Members.`);
    for (const language of ['Spanish', 'Russian', 'Arabic', 'Hindi', 'Japanese', 'Korean', 'Chinese (Simplified)']) {
      let max = 0;
      const call: Call = async (messages, { maxTokens }) => {
        const count = (JSON.parse(messages[1]!.content) as { lines: string[] }).lines.length;
        // A resent reply is at most the first call's maxTokens, whatever its script.
        const sent = messages.reduce((n, m) => n + (m.role === 'assistant' ? maxTokens : tokens(m.content)), 0);
        max = Math.max(max, sent + maxTokens);
        return messages.length > 2 ? JSON.stringify({ lines: Array.from({ length: count }, () => 'x') }) : '{"lines":[]}';
      };
      expect(await translateLines(lines, language, call)).toHaveLength(lines.length);
      expect(max, language).toBeLessThan(MAX_CALL_TOKENS);
    }
    expect(lineBudget('Hindi')).toBeLessThan(lineBudget('Spanish'));
  });

  it('saves the lines and the shown language as one step', () => {
    const p = saveTranslation(base(), { language: 'Spanish', lines: ['Hola'], show: true });
    expect(p.translations).toEqual({ Spanish: ['Hola'] });
    expect(currentCut(p).captions.language).toBe('Spanish');
    expect(steps(p).steps.map((s) => s.label)).toEqual(['Added Spanish captions']);
    const back = undo(p);
    expect(back.translations).toEqual({});
    expect(currentCut(back).captions.language).toBeUndefined();
  });
});

describe('AI suggestions', () => {
  it('become quick wins, and nothing when the AI fails', async () => {
    const wins = await aiWins(base(), units, answer({ ops: [{ op: 'cut', from: 3, to: 3, label: 'Cut the “Um”' }, { op: 'zoom', from: 5, to: 6, depth: 1.5, label: 'Zoom on Members' }] }));
    expect(wins.map((w) => [w.kind, w.title])).toEqual([['retake', 'Cut the “Um”'], ['zooms', 'Zoom on Members']]);
    expect(wins[0]!.finds[0]).toMatchObject({ start: 3000, end: 3600, units: [3] });
    expect(await aiWins(base(), units, async () => { throw new Error('down'); })).toEqual([]);
  });
});
