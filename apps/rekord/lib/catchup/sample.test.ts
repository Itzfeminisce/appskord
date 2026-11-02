import { describe, expect, it } from 'vitest';
import { quoteFound } from '../memory/check';
import { isOpenLoop } from '../memory/rank';
import { SAMPLE_ITEMS, SAMPLE_MEETINGS, seedSampleV41, V41_CATCHUP, V41_ITEMS, V41_NOW, V41_SEGMENTS, V41_TOLD_AT, type SampleStore } from '../memory/sample';
import { formatClock } from '../time';

const hhmm = (ms: number) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

describe('v4.1 sample world', () => {
  it('stages Mon 2 Nov: the meeting 13:00 to 17:00, Home 17:05, told 17:10 for 12:40', () => {
    expect(new Date(V41_CATCHUP.startedAt).toDateString()).toBe('Mon Nov 02 2026');
    expect([hhmm(V41_CATCHUP.startedAt), hhmm(V41_CATCHUP.endedAt!), hhmm(V41_NOW), hhmm(V41_TOLD_AT)]).toEqual(['13:00', '17:00', '17:05', '17:10']);
    expect(formatClock(V41_CATCHUP.told!.ms)).toBe('12:40');
    expect(V41_SEGMENTS.every((s) => s.speaker === 'you')).toBe(true);
  });

  it('every item quotes the telling, and the counts match FRAMES', () => {
    for (const i of V41_ITEMS) expect(quoteFound(i.quote, V41_SEGMENTS)).toBe(true);
    const kinds = V41_ITEMS.map((i) => i.kind);
    expect([kinds.filter((k) => k === 'promise').length, kinds.filter((k) => k === 'decision').length, kinds.filter((k) => k === 'question').length]).toEqual([2, 1, 1]);
    const open = (items: typeof SAMPLE_ITEMS) => items.map((i) => ({ ...i, status: i.status === 'suggested' ? 'open' as const : i.status })).filter((i) => isOpenLoop(i, V41_NOW));
    const count = (items: typeof SAMPLE_ITEMS) => {
      const o = open(items);
      return [o.filter((i) => i.kind === 'promise' && i.ownerId === 'me').length, o.filter((i) => i.kind === 'promise' && i.toId === 'me').length, o.filter((i) => i.kind === 'question').length];
    };
    expect(count(SAMPLE_ITEMS)).toEqual([3, 2, 1]);
    expect(count([...SAMPLE_ITEMS, ...V41_ITEMS])).toEqual([4, 3, 2]);
  });

  it('seeds 24 meetings before and 25 after', async () => {
    const put = async (moment: 'before' | 'after') => {
      const rows: [SampleStore, unknown][] = [];
      await seedSampleV41({ put: async (s, v) => rows.push([s, v]) }, moment);
      return rows.filter(([s]) => s === 'meetings').length;
    };
    expect(SAMPLE_MEETINGS).toHaveLength(24);
    expect([await put('before'), await put('after')]).toEqual([24, 25]);
  });
});
