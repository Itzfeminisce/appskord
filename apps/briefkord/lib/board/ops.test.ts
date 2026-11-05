import { describe, expect, it } from 'vitest';
import {
  addArrow,
  addCard,
  addGroup,
  addSection,
  bringToFront,
  cardNumbers,
  deleteArrow,
  deleteCards,
  deleteGroup,
  deleteSection,
  emptyBoard,
  groupRect,
  listOrder,
  moveCardInList,
  moveCards,
  moveSection,
  recolourCards,
  renameGroup,
  reconnectArrow,
  renameSection,
  reorderList,
  resizeCard,
  setArrowBoth,
  setArrowDashed,
  setArrowLabel,
  setGroupColour,
  setSectionMinutes,
  updateCard,
} from './ops';
import { sampleBoard } from './sample';
import type { Board, DiagramCard, NoteCard } from './types';
import { validateBoard } from './validate';

const T = 5000;
const sample = () => sampleBoard(1000);
const note = (id: string): NoteCard => ({
  id, kind: 'note', title: id, colour: 'white', rect: { x: 0, y: 0, w: 200, h: 100 }, z: 0, say: '', createdAt: 0, updatedAt: 0, text: '',
});

/** Every card sits in exactly one section and the board passes the validator. */
const expectSound = (b: Board) => {
  const result = validateBoard(b);
  expect(result.ok ? [] : result.problems).toEqual([]);
  expect(listOrder(b).sort()).toEqual(Object.keys(b.cards).sort());
};

describe('board ops', () => {
  it('keeps every card in exactly one section through a run of changes, without touching the input', () => {
    const before = sample();
    const frozen = structuredClone(before);
    let b = addCard(before, note('n1'), T, { sectionId: 'context', index: 0 });
    b = addCard(b, note('n2'), T);
    b = addSection(b, { id: 's4', title: 'Next steps', minutes: 3 }, T, 1);
    b = moveCardInList(b, 'n2', 's4', 0, T);
    b = moveCardInList(b, 'flow', 'context', 1, T);
    b = moveSection(b, 's4', 0, T);
    b = deleteSection(b, 'context', T);
    b = deleteCards(b, ['report', 'n1'], T);
    b = reorderList(b, ['before-ship', 'n2'], T);
    expectSound(b);
    expect(before).toEqual(frozen);
  });

  it('adds a card on top, to the last section by default, and stamps the change', () => {
    const b = addCard(sample(), note('n1'), T);
    expect(b.sections[2]!.cards.at(-1)).toBe('n1');
    expect(b.cards.n1!.z).toBe(8);
    expect(b.updatedAt).toBe(T);
    expect(addCard(b, note('n1'), T)).toBe(b);
    expect(addCard(b, note('n3'), T, { sectionId: 'missing' })).toBe(b);
  });

  it('moves, resizes, recolours and edits cards', () => {
    let b = moveCards(sample(), ['why-now', 'findings'], 10, -4, T);
    expect(b.cards['why-now']!.rect).toMatchObject({ x: 856, y: 40 });
    expect(b.cards['why-now']!.updatedAt).toBe(T);
    b = resizeCard(b, 'why-now', { x: 0, y: 0, w: 10, h: 300 }, T);
    expect(b.cards['why-now']!.rect).toEqual({ x: 0, y: 0, w: 120, h: 300 });
    b = recolourCards(b, ['findings'], 'teal', T);
    expect(b.cards.findings!.colour).toBe('teal');
    expect(recolourCards(b, ['findings'], 'teal', T)).toBe(b);
    b = updateCard(b, 'why-now', T, (c) => ({ ...c, say: 'Open with this.', kind: 'link' }) as unknown as NoteCard);
    expect(b.cards['why-now']).toMatchObject({ say: 'Open with this.', kind: 'note' });
    b = bringToFront(b, ['why-now'], T);
    expect(b.cards['why-now']!.z).toBe(8);
    expectSound(b);
  });

  it('deletes cards with their arrows, group places and diagram links', () => {
    let b = addArrow(sample(), { id: 'a1', from: 'why-now', to: 'flow' }, T);
    b = updateCard(b, 'flow', T, (c) => {
      const d = c as DiagramCard;
      return { ...d, diagram: { ...d.diagram, nodes: d.diagram.nodes.map((n) => (n.id === 'leave' ? { ...n, card: 'report' } : n)) } };
    });
    b = deleteCards(b, ['why-now'], T);
    expect(b.arrows).toEqual([]);
    b = deleteCards(b, ['report'], T);
    expect((b.cards.flow as DiagramCard).diagram.nodes.find((n) => n.id === 'leave')).not.toHaveProperty('card');
    b = deleteCards(b, ['flow'], T);
    expect(b.groups).toEqual([]);
    expect(b.sections[1]!.cards).toEqual(['step-2']);
    expectSound(b);
  });

  it('adds arrows only between two existing, different cards, once per pair', () => {
    const b = addArrow(sample(), { id: 'a1', from: 'why-now', to: 'flow' }, T);
    expect(b.arrows).toHaveLength(1);
    expect(addArrow(b, { id: 'a2', from: 'why-now', to: 'flow' }, T)).toBe(b);
    expect(addArrow(b, { id: 'a3', from: 'flow', to: 'flow' }, T)).toBe(b);
    expect(addArrow(b, { id: 'a4', from: 'flow', to: 'ghost' }, T)).toBe(b);
    expect(setArrowDashed(b, 'a1', true, T).arrows[0]!.dashed).toBe(true);
    expect(deleteArrow(b, 'a1', T).arrows).toEqual([]);
  });

  it('labels arrows, puts heads on both ends and colours groups', () => {
    let b = addArrow(sample(), { id: 'a1', from: 'why-now', to: 'flow' }, T);
    b = setArrowLabel(b, 'a1', '  shows ', T);
    expect(b.arrows[0]!.label).toBe('shows');
    expect(setArrowLabel(b, 'a1', 'shows', T)).toBe(b);
    expect('label' in setArrowLabel(b, 'a1', ' ', T).arrows[0]!).toBe(false);
    b = setArrowBoth(b, 'a1', true, T);
    expect(b.arrows[0]!.both).toBe(true);
    expect(setArrowBoth(b, 'a1', true, T)).toBe(b);
    expect(setArrowBoth(b, 'ghost', false, T)).toBe(b);
    const linked = addArrow(b, { id: 'a2', from: 'why-now', to: 'step-2' }, T);
    expect(reconnectArrow(linked, 'a1', 'to', 'why-now', T)).toBe(linked);
    expect(reconnectArrow(linked, 'a2', 'to', 'flow', T)).toBe(linked);
    expect(reconnectArrow(linked, 'a1', 'to', 'ghost', T)).toBe(linked);
    expect(reconnectArrow(linked, 'a1', 'to', 'report', T).arrows[0]).toMatchObject({ from: 'why-now', to: 'report', label: 'shows' });
    b = setGroupColour(b, 'payment-flow', 'blue', T);
    expect(b.groups[0]!.colour).toBe('blue');
    expect(setGroupColour(b, 'payment-flow', 'blue', T)).toBe(b);
    expect('colour' in setGroupColour(b, 'payment-flow', undefined, T).groups[0]!).toBe(false);
    expectSound(b);
  });

  it('groups cards, one group per card, and derives the group box from its cards', () => {
    let b = addGroup(sample(), { id: 'g2', title: 'Evidence', cards: ['flow', 'step-2', 'ghost'] }, T);
    expect(b.groups).toEqual([{ id: 'g2', title: 'Evidence', cards: ['flow', 'step-2'] }]);
    expect(groupRect(b, b.groups[0]!, 0)).toEqual({ x: 110, y: 60, w: 702, h: 440 });
    b = renameGroup(b, 'g2', 'Proof', T);
    expect(b.groups[0]!.title).toBe('Proof');
    expect(deleteGroup(b, 'g2', T).groups).toEqual([]);
  });

  it('adds, renames, times, reorders and deletes sections, moving the cards of a deleted one', () => {
    let b = renameSection(sample(), 'context', 'Background', T);
    b = setSectionMinutes(b, 'context', 4.4, T);
    expect(b.sections[0]).toMatchObject({ title: 'Background', minutes: 4 });
    b = deleteSection(b, 'the-flow', T);
    expect(b.sections.map((s) => s.id)).toEqual(['context', 'decisions']);
    expect(b.sections[0]!.cards).toEqual(['why-now', 'findings', 'flow', 'step-2']);
    b = deleteSection(b, 'context', T);
    expect(b.sections[0]!.cards).toEqual(['why-now', 'findings', 'flow', 'step-2', 'report', 'new-checkout', 'before-ship']);
    expect(deleteSection(b, 'decisions', T)).toBe(b);
    expectSound(b);
  });

  it('numbers cards by their place in the list', () => {
    let b = sample();
    expect(cardNumbers(b)).toEqual({ 'why-now': 1, findings: 2, flow: 3, 'step-2': 4, report: 5, 'new-checkout': 6, 'before-ship': 7 });
    b = moveCardInList(b, 'before-ship', 'context', 0, T);
    expect(cardNumbers(b)['before-ship']).toBe(1);
    expect(cardNumbers(b)['report']).toBe(6);
    expect(moveCardInList(b, 'before-ship', 'context', 0, T)).toBe(b);
  });

  it('applies a suggested order and keeps each section its size', () => {
    const b = reorderList(sample(), ['before-ship', 'flow', 'why-now'], T);
    expect(b.sections.map((s) => s.cards)).toEqual([
      ['before-ship', 'flow'],
      ['why-now', 'findings'],
      ['step-2', 'report', 'new-checkout'],
    ]);
  });

  it('starts an empty board with one section', () => {
    const b = emptyBoard({ board: 'b1', section: 's1' }, 'Untitled', 'Agenda', T);
    expectSound(b);
    expect(b.sections).toHaveLength(1);
  });
});
