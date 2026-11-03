import { describe, expect, it } from 'vitest';
import { sampleBoard } from './sample';
import type { Board, DiagramCard } from './types';
import { validateBoard } from './validate';

const board = (): Board => structuredClone(sampleBoard(1000));
const problems = (b: unknown): string[] => {
  const result = validateBoard(b);
  return result.ok ? [] : result.problems;
};

describe('validateBoard', () => {
  it('accepts the sample board', () => {
    const b = board();
    expect(validateBoard(b)).toEqual({ ok: true, board: b });
  });

  it('rejects an unknown version', () => {
    expect(problems({ ...board(), version: 2 })).toEqual(['unknown board version 2']);
  });

  it('rejects a card in no section', () => {
    const b = board();
    b.sections[0]!.cards = ['findings'];
    expect(problems(b)).toEqual(['card why-now is in no section']);
  });

  it('rejects a card in two sections', () => {
    const b = board();
    b.sections[1]!.cards.push('why-now');
    expect(problems(b)).toEqual(['card why-now is in two sections (context and the-flow)']);
  });

  it('rejects a board with no section', () => {
    expect(problems({ ...board(), cards: {}, groups: [], sections: [] })).toEqual(['the board has no section']);
  });

  it('rejects a section, arrow, group or diagram edge that names a missing id', () => {
    const b = board();
    b.sections[2]!.cards.push('ghost');
    b.arrows.push({ id: 'a1', from: 'why-now', to: 'ghost' });
    b.groups[0]!.cards.push('ghost');
    (b.cards.flow as DiagramCard).diagram.edges.push({ id: 'e9', from: 'cart', to: 'nowhere' });
    expect(problems(b)).toEqual([
      'cards.flow edge e9 names missing node nowhere',
      'section decisions names missing card ghost',
      'arrow a1 names missing card ghost',
      'group payment-flow names missing card ghost',
    ]);
  });

  it('rejects a diagram node linked to a missing card', () => {
    const b = board();
    (b.cards.flow as DiagramCard).diagram.nodes[0]!.card = 'ghost';
    expect(problems(b)).toEqual(['diagram node cart in card flow names missing card ghost']);
  });

  it('rejects duplicate ids', () => {
    const b = board();
    b.sections.push({ id: 'context', title: 'Again', minutes: 1, cards: [] });
    b.arrows.push({ id: 'why-now', from: 'findings', to: 'flow' });
    (b.cards.flow as DiagramCard).diagram.edges.push({ id: 'cart', from: 'cart', to: 'address' });
    b.cards['copy'] = { ...b.cards['why-now']!, id: 'why-now' };
    b.sections[0]!.cards.push('copy');
    expect(problems(b)).toEqual([
      'duplicate id cart in cards.flow.diagram',
      'cards.copy.id does not match its key',
      'duplicate id context in sections',
      'duplicate id why-now in arrows',
    ]);
  });

  it('rejects numbers that are not finite', () => {
    const b = board();
    b.cards['why-now']!.rect.x = Number.NaN;
    b.sections[0]!.minutes = Number.POSITIVE_INFINITY;
    expect(problems(b)).toEqual(['board.cards.why-now.rect.x is not a finite number', 'board.sections[0].minutes is not a finite number']);
  });

  it('rejects an unknown kind or colour and missing fields', () => {
    const b = board() as unknown as { cards: Record<string, Record<string, unknown>> };
    b.cards['why-now']!.kind = 'video';
    b.cards['findings']!.colour = 'green';
    delete b.cards['report']!.file;
    expect(problems(b)).toEqual([
      'cards.why-now.kind "video" is unknown',
      'cards.findings.colour "green" is unknown',
      'cards.report.file is missing',
    ]);
  });

  it('never throws, whatever it is given', () => {
    const loop: Record<string, unknown> = { ...board() };
    loop.self = loop;
    for (const value of [null, undefined, 42, 'board', [], { version: 1 }, loop]) {
      expect(() => validateBoard(value)).not.toThrow();
      expect(validateBoard(value).ok).toBe(false);
    }
  });
});
