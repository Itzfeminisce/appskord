import { describe, expect, it } from 'vitest';
import { LINE_MS, TELLINGS } from '@/lib/catchup/fixtures';
import { cover } from '@/lib/catchup/coverage';
import { estimateTokens, MAX_PART_TOKENS } from '@/lib/memory/extract';
import {
  catchupSystem, catchupText, coverageDelays, extractUsers, itemsFrom, matchSheet, scoreCoverage, scoreExtraction, scrub, tellingSegments,
  type CatchupResult,
} from './catchup';

describe('fixtures', () => {
  it('are 10, 20 and 30 minutes with ten answers in all', () => {
    expect(TELLINGS.map((t) => t.lines.length * LINE_MS / 60_000)).toEqual([10, 20, 30]);
    expect(TELLINGS.flatMap((t) => t.sheet)).toHaveLength(10);
  });
  it('say every sheet owner aloud near a date', () => {
    for (const t of TELLINGS) for (const s of t.sheet) expect(t.lines.some((l) => l.includes(s.owner) && /\b(?:by|on|for|tomorrow)\b/i.test(l))).toBe(true);
  });
  it('touch all four prompts and keep each extraction part under the call budget', () => {
    for (const t of TELLINGS) {
      expect(cover(tellingSegments(t, t.id)).every((c) => c.coveredAtMs !== undefined)).toBe(true);
      for (const u of extractUsers(t)) expect(estimateTokens(u)).toBeLessThan(MAX_PART_TOKENS + 400);
    }
  });
});

describe('extraction prompt', () => {
  it('starts with the catch-up preamble and the meeting date', () => {
    const t = TELLINGS[0]!;
    expect(catchupSystem(t.startedAt)).toMatch(/^This is the user retelling a meeting from memory\./);
    expect(catchupSystem(t.startedAt)).toContain('2026-10-26');
    expect(extractUsers(t)[0]).toContain('Meeting date: 2026-10-26');
  });
});

describe('matchSheet', () => {
  const sheet = [{ owner: 'Priya', due: '2026-10-30' }, { owner: 'Marcus', due: '2026-11-04' }];
  it('counts owner and due date together', () => {
    expect(matchSheet(sheet, [{ kind: 'promise', owner: 'Priya Rao', due: '2026-10-30' }, { kind: 'promise', owner: 'Marcus', due: '2026-11-05' }])).toBe(1);
  });
  it('ignores decisions and ownerless promises', () => {
    expect(matchSheet(sheet, [{ kind: 'decision', owner: 'Priya', due: '2026-10-30' }, { kind: 'promise', due: '2026-11-04' }])).toBe(0);
  });
  it('reads items out of model replies', () => {
    const reply = '{"items":[{"kind":"promise","text":"Send deck","quote":"q","speaker":"You","owner":"Priya","due":"2026-10-30"}],"done":[]}';
    expect(matchSheet(sheet, itemsFrom([reply, 'not json']))).toBe(1);
  });
});

describe('scores', () => {
  it('goes at 9 of 10 and not at 8', () => {
    expect(scoreExtraction(9, 10)).toBe('go');
    expect(scoreExtraction(8, 10)).toBe('no-go');
    expect(scoreExtraction(0, 0)).toBe('no-go');
  });
  it('ticks within 15 s on every sample telling', () => {
    const r = scoreCoverage(TELLINGS.map((t) => coverageDelays(t)));
    expect(r.verdict).toBe('go');
    expect(r.worstMs).toBeLessThan(15_000);
  });
  it('is No-go when a prompt never ticks or is late', () => {
    expect(scoreCoverage([{ who: 1000 }]).verdict).toBe('no-go');
    expect(scoreCoverage([{ who: 1000, decided: 1000, promised: 1000, open: 15_000 }]).verdict).toBe('no-go');
  });
});

describe('no key in check output', () => {
  const keys = ['gsk_test1234567890', 'sk-test-abcdefghij', 'Bearer abcdefgh12345678', 'access_token=ya29.abcdefghijk', 'AIzaSyabcdefghijk'];
  it('scrub removes keys and tokens', () => {
    for (const k of keys) expect(scrub(`Request failed for ${k} on the server`)).not.toContain(k.split(/[ =]/).at(-1)!);
  });
  it('scrub removes the exact key it is given', () => {
    expect(scrub('bad key zzz-custom-key-1 here', ['zzz-custom-key-1'])).not.toContain('zzz-custom-key-1');
  });
  it('the copied text carries none of them, and names the fallback on a No-go', () => {
    const results: CatchupResult[] = [
      { id: 'mic', verdict: 'no-go', value: 'Failed', note: `401 with ${keys[0]}` },
      { id: 'extract', verdict: 'no-go', value: '5 of 10', note: keys[1] },
      { id: 'coverage', verdict: 'go', value: 'worst 10 s' },
    ];
    const text = catchupText(results);
    for (const k of keys.slice(0, 2)) expect(text).not.toContain(k);
    expect(text).toContain('Fallback: Start from a Rekord tab page');
    expect(text).toContain('Fallback: A stronger instruction');
    expect(text).not.toContain('Fallback: Prompts stay');
  });
});
