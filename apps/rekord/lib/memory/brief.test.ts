import { describe, expect, it } from 'vitest';
import { buildBrief, briefNote, dueNote, dueToday, localLastTime, parseLines, whenChip } from './brief';
import { M, SAMPLE_EVENT, SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_NOW, SAMPLE_PEOPLE } from './sample';

const event = { ...SAMPLE_EVENT, attendees: [...SAMPLE_EVENT.attendees, { name: 'Priya Nair', email: 'priya@rekord-team.com' }] };
const brief = () => buildBrief({ event, people: SAMPLE_PEOPLE, items: SAMPLE_ITEMS, meetings: SAMPLE_MEETINGS, now: SAMPLE_NOW });

describe('brief', () => {
  it('lists who is coming, last time and what is open between you', () => {
    const b = brief();
    expect(b.who.map((w) => [w.name, w.known])).toEqual([['Sarah Chen', true], ['Priya Nair', true]]);
    expect(b.firstMeeting).toBe(false);
    expect(b.last?.id).toBe(M.sarah27);
    // Priya's launch copy is due after the meeting day, so it waits.
    expect(b.rows.map((r) => [r.label, r.item.text])).toEqual([
      ['You owe Sarah', 'Send the revised pricing deck'],
      ['Sarah owes you', 'Q3 usage numbers'],
      ['Still open', 'Do we keep the free plan?'],
    ]);
    expect(whenChip(event, SAMPLE_NOW)).toEqual({ soon: true, label: 'in 5 min' });
  });

  it('is a first-meeting brief when nobody is known', () => {
    const halcyon = { ...SAMPLE_EVENT, id: 'h', attendees: [{ name: 'Marco Bell', email: 'marco@halcyon.studio' }] };
    const b = buildBrief({ event: halcyon, people: SAMPLE_PEOPLE, items: SAMPLE_ITEMS, meetings: SAMPLE_MEETINGS, now: SAMPLE_NOW });
    expect(b.firstMeeting).toBe(true);
    expect(b.rows).toEqual([]);
    expect(b.last).toBeUndefined();
  });

  it('words the brief and due-day notifications', () => {
    expect(briefNote(brief(), SAMPLE_NOW)).toEqual({
      title: 'Brief · 1:1 with Sarah in 5 min',
      message: 'You owe the pricing deck (4 days late). Sarah owes Q3 usage numbers today.',
      buttons: [{ title: 'Open brief' }],
    });
    const [q3] = dueToday(SAMPLE_ITEMS, SAMPLE_NOW);
    expect(q3?.id).toBe('i-q3');
    expect(dueNote(q3!, SAMPLE_PEOPLE[0]!, [SAMPLE_EVENT], SAMPLE_NOW)).toEqual({
      title: 'Due today: Sarah’s Q3 usage numbers',
      message: 'Sarah owes you these today, before your 1:1.',
      buttons: [{ title: 'Nudge' }, { title: 'Snooze' }],
    });
  });

  it('keeps three lines of last time, from the AI or local memory', () => {
    expect(parseLines('- One.\n2. Two.\n\nThree.\nFour.')).toEqual(['One.', 'Two.', 'Three.']);
    expect(localLastTime(M.sarah27, SAMPLE_ITEMS, SAMPLE_PEOPLE)).toEqual(['Northwind rollout starts 9 Nov.', 'Sarah owes you Q3 usage numbers.']);
  });
});
