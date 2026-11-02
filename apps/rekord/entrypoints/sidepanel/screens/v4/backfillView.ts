// Until T2 exports it: what the backfill engine keeps in chrome.storage.local under BACKFILL_KEY.
export const BACKFILL_KEY = 'rekord.backfill';

export interface BackfillMeeting { id: string; title: string; status: 'done' | 'working' | 'waiting'; found?: number }
export interface BackfillProgress {
  meetings: BackfillMeeting[];
  done: number;
  total: number;
  resumeAt?: number;
  totals?: { promises: number; decisions: number; people: number };
}

/** Rows shown in full: up to 3 finished meetings before the current one, then the next ones. */
export const SHOWN_ROWS = 5;

export interface BackfillView { rows: BackfillMeeting[]; more: { count: number; done: number; waiting: number } }

/** The rows around the meeting being worked on, and a count of the rest. */
export function backfillView(meetings: BackfillMeeting[]): BackfillView {
  const at = meetings.findIndex((m) => m.status !== 'done');
  const current = at < 0 ? meetings.length : at;
  const start = Math.max(0, Math.min(current - 3, meetings.length - SHOWN_ROWS));
  const rows = meetings.slice(start, start + SHOWN_ROWS);
  const rest = [...meetings.slice(0, start), ...meetings.slice(start + SHOWN_ROWS)];
  return {
    rows,
    more: { count: rest.length, done: rest.filter((m) => m.status === 'done').length, waiting: rest.filter((m) => m.status !== 'done').length },
  };
}

/** "and 18 more: 6 done, 12 waiting" */
export function moreLine({ count, done, waiting }: BackfillView['more']): string {
  const parts = [done ? `${done} done` : '', waiting ? `${waiting} waiting` : ''].filter(Boolean);
  return `and ${count} more: ${parts.join(', ')}`;
}
