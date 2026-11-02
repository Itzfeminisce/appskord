import { describe, expect, it } from 'vitest';
import { agendaLine, agendaMinutes, inviteTopics, moveItem, suggestAgenda, topicOf, withGoal } from './agenda';
import { SAMPLE_AGENDA, SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_NOW } from './sample';

const byId = (id: string) => SAMPLE_ITEMS.find((i) => i.id === id)!;

describe('agenda', () => {
  it('totals minutes against the meeting length', () => {
    expect(agendaMinutes(SAMPLE_AGENDA.items)).toBe(25);
    expect(agendaLine(SAMPLE_AGENDA)).toBe('4 items · 25 of 30 min');
    expect(agendaMinutes([{ ...SAMPLE_AGENDA.items[0]!, skipped: true }, SAMPLE_AGENDA.items[1]!])).toBe(10);
  });

  it('suggests open loops (owed to you first) then the invite’s own items', () => {
    const event = { ...SAMPLE_EVENT, description: 'Agenda:\n- Northwind rollout date' };
    const agenda = suggestAgenda(event, [byId('i-deck'), byId('i-q3')], SAMPLE_NOW);
    expect(agenda.items.map((i) => [i.text, i.source, i.minutes])).toEqual([
      ['Q3 usage numbers', 'promise', 5],
      ['Revised pricing deck', 'promise', 10],
      ['Northwind rollout date', 'invite', 5],
    ]);
    expect(agenda.totalMinutes).toBe(30);
    expect(agendaLine(agenda)).toBe('3 items · 20 of 30 min');
  });

  it('names the thing, reads invite lists, puts the goal first and reorders', () => {
    expect(topicOf('Send the revised pricing deck')).toBe('Revised pricing deck');
    expect(inviteTopics('Hi all\n1. Pricing\n* Seats\nThanks')).toEqual(['Pricing', 'Seats']);
    const goal = withGoal(SAMPLE_AGENDA, 'Learn what Halcyon needs');
    expect(goal.items[0]).toMatchObject({ text: 'Learn what Halcyon needs', source: 'you' });
    expect(withGoal(goal, 'Changed').items.filter((i) => i.source === 'you')).toHaveLength(2);
    expect(moveItem(SAMPLE_AGENDA.items, 3, 0).map((i) => i.id)).toEqual(['a-seats', 'a-q3', 'a-deck', 'a-rollout']);
  });
});
