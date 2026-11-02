import { describe, expect, it } from 'vitest';
import { CHECKS, resultsText, scoreEmbed, scoreExtract, scoreFolder, scoreMemory, scoreNotification, scoreRecall, scoreSearch, scoreTasks, syntheticSegments, syntheticWindows } from './score';

describe('machine check scoring', () => {
  it('scores times against the budget, edges included', () => {
    expect(scoreEmbed(59.9)).toBe('go');
    expect(scoreEmbed(60)).toBe('no-go');
    expect(scoreSearch(299)).toBe('go');
    expect(scoreSearch(300)).toBe('no-go');
    expect(scoreExtract(10)).toBe('go');
    expect(scoreRecall(15)).toBe('no-go');
    expect(scoreRecall(NaN)).toBe('no-go');
  });

  it('uses the worst memory figure and fails without one', () => {
    expect(scoreMemory([200, undefined])).toBe('go');
    expect(scoreMemory([200, 450])).toBe('no-go');
    expect(scoreMemory([undefined])).toBe('no-go');
  });

  it('scores the yes or no checks', () => {
    expect(scoreNotification(true)).toBe('go');
    expect(scoreNotification(false)).toBe('no-go');
    expect(scoreFolder('granted', false)).toBe('go');
    expect(scoreFolder('prompt', true)).toBe('go');
    expect(scoreFolder('prompt', false)).toBe('no-go');
    expect(scoreFolder('denied', true)).toBe('no-go');
    expect(scoreTasks(true)).toBe('go');
    expect(scoreTasks(false)).toBe('no-go');
  });

  it('writes one line per check and marks the ones not run', () => {
    const text = resultsText([{ id: 1, verdict: 'go', value: '12.0 s' }, { id: 8, verdict: 'no-go', value: 'refused', note: 'closed' }], 'Chrome 156');
    const lines = text.split('\n');
    expect(lines).toHaveLength(2 + CHECKS.length);
    expect(lines[2]).toBe('1. Embed a 1-hour transcript: 12.0 s (target under 60 s) Go');
    expect(lines[3]).toContain('Not run');
    expect(lines[9]).toContain('No-go - closed');
  });

  it('builds the synthetic hour', () => {
    expect(syntheticWindows()).toHaveLength(720);
    const segs = syntheticSegments('m');
    expect(segs).toHaveLength(360);
    expect(segs.every((s) => s.text.length > 0)).toBe(true);
    expect(segs[359]!.endMs).toBeLessThan(3_600_000);
  });
});
