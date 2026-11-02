import { describe, expect, it } from 'vitest';
import { SAMPLE_LEDGER } from '@/lib/memory/sample';
import type { LedgerEntry } from '@/lib/memory/types';
import { meetingRows, redactionLine, weekStart, weekTotals } from './ledgerView';

const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).getTime();

describe('ledger rows', () => {
  it('shows the 1:1 exactly as V4Ledger does', () => {
    const shuffled = [...SAMPLE_LEDGER].reverse();
    expect(meetingRows(shuffled).map((r) => [r.name, r.detail, r.time])).toEqual([
      ['Google Calendar', 'Read this event', '09:55'],
      ['Groq', 'Audio for transcription · 32 parts', '10:00 to 10:32'],
      ['Groq', 'Ask and What did I miss? · 2 requests', '10:14, 10:21'],
      ['Groq', 'Clash checks · every 60 s while on · 30 checks', ''],
      ['Groq', 'Transcript text for summary and memory', '10:33'],
      ['Google Tasks', '2 tasks', '10:36'],
      ['Off the record', '2 min · nothing sent', '10:18'],
    ]);
    expect(meetingRows(SAMPLE_LEDGER).at(-1)?.dark).toBe(true);
  });

  it('shows the redaction date last', () => {
    const red: LedgerEntry = { id: 'r', meetingId: 'm', service: 'redaction', what: 'Redacted', count: 1, firstAt: at(3, 10, 41), lastAt: at(3, 10, 41) };
    const mark = { startMs: 1_270_000, endMs: 1_312_000, at: at(3, 10, 41) };
    expect(redactionLine(mark)).toBe('Tue 3 Nov, 10:41 · 0:42');
    const rows = meetingRows([red, ...SAMPLE_LEDGER], [mark]);
    expect(rows.at(-1)).toMatchObject({ name: 'Redacted', detail: 'Tue 3 Nov, 10:41 · 0:42' });
  });
});

describe('All meetings · this week', () => {
  it('adds up this week per service and leaves earlier weeks out', () => {
    const old: LedgerEntry = { id: 'o', meetingId: 'x', service: 'groq', what: 'Audio for transcription', count: 99, firstAt: at(1, 9, 0), lastAt: at(1, 9, 30) };
    const other: LedgerEntry = { id: 'n', meetingId: 'y', service: 'groq', what: 'Audio for transcription', count: 10, firstAt: at(2, 9, 0), lastAt: at(2, 9, 10) };
    const totals = weekTotals([old, other, ...SAMPLE_LEDGER], at(3, 10, 40));
    expect(weekStart(at(3, 10, 35))).toBe(at(2, 0, 0));
    expect(totals.map((t) => [t.name, t.count, t.meetings])).toEqual([
      ['Groq', 32 + 2 + 30 + 1 + 10, 2],
      ['Google Calendar', 1, 1],
      ['Google Tasks', 2, 1],
      ['Off the record', 1, 1],
    ]);
  });
});
