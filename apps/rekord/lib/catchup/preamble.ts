// The catch-up preamble for the v4 summary and extraction calls (PLAN "Engineering"). Pure.
import { isoDay } from '../memory/rank';
import type { Meeting } from '../types';

/** "This is the user retelling a meeting from memory. … Work out dates from the meeting date 2026-11-02." */
export function catchupPreamble(meetingStartedAt: number): string {
  return 'This is the user retelling a meeting from memory. Lines are the user\'s words. Attribute promises, decisions and questions to the people the user names, not to the speaker of the line. '
    + `Work out dates from the meeting date ${isoDay(meetingStartedAt)}.`;
}

/** The preamble for a catch-up, '' for any other meeting (missing source = 'tab'). */
export function preambleFor(meeting: Pick<Meeting, 'source' | 'startedAt'>): string {
  return meeting.source === 'catchup' ? catchupPreamble(meeting.startedAt) : '';
}
