import { describe, expect, it } from 'vitest';
import { sampleBoard } from '../board/sample';
import { agenda, agendaCards, endLine, plannedMinutes, sectionTimes, stepOf } from './agenda';
import { clockText, durationText, elapsed, overBy, spentIn, startClock, switchSection, timerText } from './clock';
import { meetingKey, stepTo, type MeetingKey } from './keys';

const MIN = 60_000;

describe('clock', () => {
  it('books time to the section that was running', () => {
    let c = startClock('context', 0);
    c = switchSection(c, 'the-flow', 2 * MIN + 5_000);
    c = switchSection(c, 'decisions', 2 * MIN + 5_000 + 5 * MIN + 40_000);
    expect(spentIn(c, 'context', 10 * MIN)).toBe(125_000);
    expect(spentIn(c, 'the-flow', 10 * MIN)).toBe(340_000);
    expect(spentIn(c, 'decisions', 10 * MIN)).toBe(10 * MIN - 465_000);
    expect(elapsed(c, 10 * MIN)).toBe(10 * MIN);
  });

  it('stops on the end screen and picks up again on the way back', () => {
    let c = startClock('context', 0);
    c = switchSection(c, null, MIN);
    expect(elapsed(c, 5 * MIN)).toBe(MIN);
    c = switchSection(c, 'context', 5 * MIN);
    expect(spentIn(c, 'context', 6 * MIN)).toBe(2 * MIN);
  });

  it('moving within a section keeps the clock as it is', () => {
    const c = startClock('context', 0);
    expect(switchSection(c, 'context', 30_000)).toBe(c);
  });

  it('reads the timer and over time', () => {
    expect(clockText(400_000)).toBe('06:40');
    expect(durationText(125_000)).toBe('2:05');
    expect(durationText(860_000)).toBe('14:20');
    expect(timerText(400_000, 15)).toEqual({ time: '06:40', plan: '/ 15 min', over: false });
    expect(timerText(980_000, 15)).toEqual({ time: '16:20', plan: '/ 15 min · 1 min over', over: true });
    expect(timerText(15 * MIN + 10_000, 15).plan).toBe('/ 15 min · 1 min over');
    expect(timerText(15 * MIN, 15).over).toBe(false);
    expect(timerText(90_000, 0)).toEqual({ time: '01:30', plan: '', over: false });
    expect(overBy(395_000, 5)).toBe(95_000);
    expect(overBy(395_000, 0)).toBe(0);
  });
});

describe('agenda', () => {
  const board = sampleBoard(0);

  it('lists sections with cards in list order, numbered', () => {
    const a = agenda(board);
    expect(a.map((s) => `${s.number} · ${s.title}`)).toEqual(['1 · Context', '2 · The flow', '3 · Decisions']);
    expect(agendaCards(a).map((c) => c.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(agendaCards(a)[2]!.id).toBe('flow');
  });

  it('leaves out empty sections but keeps the numbers of the list', () => {
    const b = { ...board, sections: [{ id: 'empty', title: 'Empty', minutes: 3, cards: [] }, ...board.sections] };
    const a = agenda(b);
    expect(a[0]!.number).toBe(2);
    expect(plannedMinutes(b)).toBe(18);
  });

  it('marks done, current and next', () => {
    expect([0, 2, 5].map((i) => stepOf(i, 2))).toEqual(['done', 'current', 'next']);
  });

  it('gives the time per section with over time', () => {
    let c = startClock('context', 0);
    c = switchSection(c, 'the-flow', 125_000);
    c = switchSection(c, 'decisions', 465_000);
    c = switchSection(c, null, 465_000 + 815_000);
    const times = sectionTimes(agenda(board), c, 99 * MIN);
    expect(times.map((t) => [t.time, t.label])).toEqual([
      ['2:05', 'Context · 0:05 over'],
      ['5:40', 'The flow'],
      ['13:35', 'Decisions · 6:35 over'],
    ]);
    expect(endLine(7, 860_000, 15)).toBe('7 cards in 14:20, planned 15 min. Your notes and the board are saved on this computer.');
    expect(endLine(1, 40_000, 0)).toBe('1 card in 0:40. Your notes and the board are saved on this computer.');
  });
});

describe('meeting keys', () => {
  const key = (k: string, patch: Partial<MeetingKey> = {}): MeetingKey => ({ key: k, ctrl: false, meta: false, alt: false, typing: false, ...patch });

  it('maps → ← N F Esc', () => {
    expect(['ArrowRight', 'ArrowLeft', 'n', 'N', 'f', 'Escape', 'x'].map((k) => meetingKey(key(k)))).toEqual(['next', 'previous', 'notes', 'notes', 'full-screen', 'end', null]);
  });

  it('ignores modified keys and typing, except Esc', () => {
    expect(meetingKey(key('f', { ctrl: true }))).toBeNull();
    expect(meetingKey(key('ArrowRight', { alt: true }))).toBeNull();
    expect(meetingKey(key('n', { typing: true }))).toBeNull();
    expect(meetingKey(key('Escape', { typing: true }))).toBe('end');
  });

  it('walks the cards, past the last one to the end screen and back', () => {
    const count = 7;
    let at = 0;
    at = stepTo(at, count, 'previous');
    expect(at).toBe(0);
    for (let i = 0; i < 6; i++) at = stepTo(at, count, 'next');
    expect(at).toBe(6);
    at = stepTo(at, count, 'next');
    expect(at).toBe(count);
    expect(stepTo(at, count, 'next')).toBe(count);
    expect(stepTo(at, count, 'previous')).toBe(6);
  });
});
