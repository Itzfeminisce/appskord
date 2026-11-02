import { describe, expect, it } from 'vitest';
import { buildQuestionsPrompt, findGaps, parseQuestions, QUESTIONS_SYSTEM, type DraftItem } from './questions';

const draft: DraftItem[] = [
  { kind: 'decision', text: 'The pilot starts with Northwind’s Support team' },
  { kind: 'promise', text: 'Send the Q4 plan draft', owner: 'You', to: 'Sarah', due: '2026-11-04' },
  { kind: 'promise', text: 'Admin access for the pilot', owner: 'Tom', to: 'You' },
  { kind: 'question', text: 'Who signs off on the training budget?' },
];

describe('findGaps', () => {
  it('finds the sample world’s three gaps', () => {
    expect(findGaps(draft, ['Sarah Chen', 'Tom Becker', 'Priya Nair']).map((g) => g.about)).toEqual(['due', 'outcome', 'owner']);
  });

  it('flags promises with no owner and people named only vaguely', () => {
    const gaps = findGaps([{ kind: 'promise', text: 'Book the room', due: '2026-11-05' }, { kind: 'promise', text: 'Send the contract', owner: 'someone from finance', due: '2026-11-05' }]);
    expect(gaps.map((g) => g.about)).toEqual(['owner', 'name']);
  });

  it('has nothing to ask about a complete draft', () => {
    expect(buildQuestionsPrompt({ title: 'T', date: '2026-11-02', items: [draft[1]!] })).toBeUndefined();
  });
});

describe('buildQuestionsPrompt', () => {
  it('names the meeting, its date and the gaps, within budget', () => {
    const p = buildQuestionsPrompt({ title: 'Q4 planning with Northwind', date: '2026-11-02', items: draft, attendees: ['Priya Nair'] })!;
    expect(p).toContain('Meeting date: 2026-11-02');
    expect(p).toContain('[due] Promise with no due date (owner Tom): "Admin access for the pilot"');
    expect(p).toContain('Priya Nair was there but nothing is on them');
    const many = Array.from({ length: 200 }, (_, i): DraftItem => ({ kind: 'question', text: `Question ${i} ${'x'.repeat(500)}` }));
    expect((buildQuestionsPrompt({ title: 'T', date: 'd', items: many })! + QUESTIONS_SYSTEM).length).toBeLessThan(8_000);
  });
});

describe('parseQuestions', () => {
  it('reads at most 3 valid questions', () => {
    const raw = '```json\n{"questions":[{"text":"Tom is setting up admin access for the pilot. By when?","about":"due"},{"text":"Who signs off on the training budget?","about":"outcome"},{"text":"bad","about":"mood"},{"text":"Priya was there. Did she take anything on?","about":"owner"},{"text":"Fourth?","about":"name"}]}\n```';
    expect(parseQuestions(raw)).toEqual([
      { id: 'q1', text: 'Tom is setting up admin access for the pilot. By when?', about: 'due' },
      { id: 'q2', text: 'Who signs off on the training budget?', about: 'outcome' },
      { id: 'q3', text: 'Priya was there. Did she take anything on?', about: 'owner' },
    ]);
  });

  it('gives none for bad JSON or a bad shape', () => {
    for (const raw of ['', 'no questions', '{"questions": [', '{"questions": "x"}', '[{"text":"a","about":"due"}]', 'null']) expect(parseQuestions(raw)).toEqual([]);
  });
});
