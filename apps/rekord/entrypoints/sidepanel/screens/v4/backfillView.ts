import type { BackfillMeeting } from '@/lib/memory/backfill';

const finished = (m: BackfillMeeting) => m.status === 'done' || m.status === 'failed';

/** Rows shown in full: up to 3 finished meetings before the current one, then the next ones. */
export const SHOWN_ROWS = 5;

export interface BackfillView { rows: BackfillMeeting[]; more: { count: number; done: number; waiting: number } }

/** The rows around the meeting being worked on, and a count of the rest. */
export function backfillView(meetings: BackfillMeeting[]): BackfillView {
  const at = meetings.findIndex((m) => !finished(m));
  const current = at < 0 ? meetings.length : at;
  const start = Math.max(0, Math.min(current - 3, meetings.length - SHOWN_ROWS));
  const rows = meetings.slice(start, start + SHOWN_ROWS);
  const rest = [...meetings.slice(0, start), ...meetings.slice(start + SHOWN_ROWS)];
  return {
    rows,
    more: { count: rest.length, done: rest.filter(finished).length, waiting: rest.filter((m) => !finished(m)).length },
  };
}

/** "and 18 more: 6 done, 12 waiting" */
export function moreLine({ count, done, waiting }: BackfillView['more']): string {
  const parts = [done ? `${done} done` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean);
  return `and ${count} more: ${parts.join(', ')}`;
}
