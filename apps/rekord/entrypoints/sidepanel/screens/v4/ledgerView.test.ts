import { describe, expect, it } from 'vitest';
import { SAMPLE_LEDGER } from '@/lib/memory/sample';
import type { LedgerEntry } from '@/lib/memory/types';
import { meetingRows, periodStart, periodTotals, redactionLine, weekStart } from './ledgerView';

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

describe('V4LedgerAll', () => {
  const now = at(3, 10, 40);
  const old: LedgerEntry = { id: 'o', meetingId: 'x', service: 'groq', what: 'Audio for transcription', count: 99, firstAt: at(1, 9, 0) - 9 * 86_400_000, lastAt: at(1, 9, 30) - 9 * 86_400_000 };
  const other: LedgerEntry = { id: 'n', meetingId: 'y', service: 'groq', what: 'Audio for transcription', count: 10, firstAt: at(2, 9, 0), lastAt: at(2, 9, 10) };
  const model: LedgerEntry = { id: 'h', service: 'huggingface', what: 'Search model download', count: 1, firstAt: new Date(2026, 9, 29, 9).getTime(), lastAt: new Date(2026, 9, 29, 9).getTime() };

  it('starts "This week" last Monday, "This month" a month back and "All time" at the first call', () => {
    expect(weekStart(at(3, 10, 35))).toBe(at(2, 0, 0));
    expect(periodStart('week', now, [])).toBe(new Date(2026, 9, 26).getTime());
    expect(periodStart('month', now, [])).toBe(new Date(2026, 9, 3).getTime());
    expect(periodStart('all', now, [old, other])).toBe(new Date(2026, 9, 23).getTime());
  });

  it('adds up each service in the period, leaves local rows out and lists connectable services with nothing', () => {
    const rows = periodTotals([old, other, model, ...SAMPLE_LEDGER], periodStart('week', now, []), now);
    expect(rows.map((r) => [r.name, r.detail])).toEqual([
      ['huggingface.co', 'Search model, once · 29 Oct'],
      ['Groq', 'Audio and text from 2 meetings · 75 requests'],
      ['Google Calendar', 'Read 1 event'],
      ['Google Tasks', '2 tasks sent'],
      ['Notion', 'Nothing yet'],
      ['Linear', 'Nothing yet'],
    ]);
    expect(rows.filter((r) => r.none).map((r) => r.icon)).toEqual(['none', 'none']);
  });
});
