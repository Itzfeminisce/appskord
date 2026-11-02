import { describe, expect, it } from 'vitest';
import { V41_SEGMENTS } from '../memory/sample';
import type { Segment } from '../types';
import { CATCHUP_PROMPTS, cover, PROMPT_TEXT, speaksTo, talkingAbout } from './coverage';

const seg = (startMs: number, text: string, interim = false): Segment => ({ id: `s${startMs}`, meetingId: 'm', speaker: 'you', startMs, endMs: startMs + 1000, text, chunkId: 'c', ...(interim ? { interim } : {}) });
const upTo = (ms: number) => V41_SEGMENTS.filter((s) => s.startMs <= ms);

describe('cover', () => {
  it('ticks the prompts at the sample telling’s times (V41Tell at 06:15)', () => {
    expect(cover(upTo(375_000))).toEqual([
      { prompt: 'who', coveredAtMs: 40_000 },
      { prompt: 'decided', coveredAtMs: 185_000 },
      { prompt: 'promised', coveredAtMs: 348_000 },
      { prompt: 'open' },
    ]);
    expect(talkingAbout(upTo(375_000))).toBe('promised');
    expect(cover(V41_SEGMENTS).find((c) => c.prompt === 'open')?.coveredAtMs).toBe(500_000);
  });

  it('ignores interim and empty lines, and keeps the order asked for', () => {
    const lines = [seg(1000, 'We decided to ship it', true), seg(2000, '  '), seg(3000, 'Is the budget approved?')];
    expect(cover(lines, ['open', 'decided'])).toEqual([{ prompt: 'open', coveredAtMs: 3000 }, { prompt: 'decided', coveredAtMs: 3000 }]);
    expect(cover([])).toEqual(CATCHUP_PROMPTS.map((prompt) => ({ prompt })));
    expect(talkingAbout([])).toBeUndefined();
  });

  it('does not read "wasn\'t there" as who was there', () => {
    expect(speaksTo('who', "Priya wasn't there")).toBe(false);
    expect(speaksTo('who', 'They weren’t there')).toBe(false);
    expect(speaksTo('who', 'Priya was there')).toBe(true);
  });

  it('matches cue words, not passing mentions', () => {
    expect(speaksTo('promised', 'She’ll send the numbers by Friday')).toBe(true);
    expect(speaksTo('promised', 'Then we went through the timeline for the pilot.')).toBe(false);
    expect(speaksTo('who', 'Then we went through the timeline for the pilot.')).toBe(false);
    expect(speaksTo('open', 'We are not sure about pricing')).toBe(true);
  });

  it('labels the prompts as the frames do', () => {
    expect(CATCHUP_PROMPTS.map((p) => PROMPT_TEXT[p])).toEqual(['Who was there', 'What was decided', 'Who promised what, and by when', 'What is still open']);
  });
});
