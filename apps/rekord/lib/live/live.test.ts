import { describe, expect, it, vi } from 'vitest';
import { M, SAMPLE_AGENDA, SAMPLE_ITEMS, SAMPLE_MEETINGS, SAMPLE_PEOPLE } from '../memory/sample';
import type { SearchResult } from '../recall';
import { DEFAULT_SETTINGS } from '../settings';
import type { Segment } from '../types';
import { bringBack, mentions, minutesLeft, skipItem, trackAgenda } from './agenda';
import { clashCandidates, confirmClash, parseClash, replacingDecision } from './clash';
import { missedWindow, parseMissed, whatDidIMiss, MISSED_LEDGER_WHAT } from './missed';
import { gatedChunks, goOff, goOn, inOffSpan, OffRecordGate, spanLabel, offClock } from './offRecord';
import { Chunker } from '../audio/chunker';
import type { Chunk } from '../types';
import { promiseFromQuestion, promiseText, questionsForYou } from './questions';
import { findRecall, recallAllowed, recallCard, recentText, RECALL_GAP_MS } from './recall';

const mmss = (m: number, s: number) => (m * 60 + s) * 1000;
const seg = (m: number, s: number, text: string, speaker: 'you' | 'others' = 'others', extra: Partial<Segment> = {}): Segment => ({
  id: `s-${m}-${s}`, meetingId: M.sarah3, speaker, startMs: mmss(m, s), endMs: mmss(m, s) + 6000, text, chunkId: 'c', ...extra,
});
const item = (id: string) => SAMPLE_ITEMS.find((i) => i.id === id)!;
const NOW = new Date(2026, 10, 3, 10, 18, 42).getTime();
const AI = { settings: DEFAULT_SETTINGS, keys: { GROQ_API_KEY: 'gsk_test' } };
const reply = (content: string) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })));
const noRecord = vi.fn(async () => ({ id: '', service: 'groq' as const, what: '', count: 0, firstAt: 0, lastAt: 0 }));

const ONE_ON_ONE = [
  seg(0, 20, 'Let’s start with the Q3 usage numbers.'),
  seg(4, 10, 'The Q3 usage numbers are in the doc I shared.'),
  seg(4, 40, 'Great. Next, the revised pricing deck.', 'you'),
  seg(12, 30, 'I’ll finish the pricing deck changes.', 'you'),
  seg(15, 42, 'Now the Northwind rollout date.'),
  seg(16, 5, 'Can you send the deck today?'),
  seg(16, 30, 'For the rollout date, the 9th is still the plan.', 'you'),
  seg(18, 36, 'Want the seat count before or after that?', 'you'),
];

describe('recall cards', () => {
  it('shows at most one card every 2 minutes, none while one is up, none once muted', () => {
    expect(recallAllowed({ muted: false, showing: false }, NOW)).toBe(true);
    expect(recallAllowed({ muted: false, showing: false, lastShownAt: NOW - RECALL_GAP_MS + 1 }, NOW)).toBe(false);
    expect(recallAllowed({ muted: false, showing: false, lastShownAt: NOW - RECALL_GAP_MS }, NOW)).toBe(true);
    expect(recallAllowed({ muted: false, showing: true }, NOW)).toBe(false);
    expect(recallAllowed({ muted: true, showing: false }, NOW)).toBe(false);
  });

  it('words the card from stored text: one decision and one promise', () => {
    const card = recallCard([item('d-team-12'), item('i-q3')], SAMPLE_MEETINGS, SAMPLE_PEOPLE, NOW)!;
    expect(card.text).toBe('On 26 Oct you decided $12 a seat. Sarah owed the Q3 usage numbers, due today.');
    const owed = recallCard([item('i-deck')], SAMPLE_MEETINGS, SAMPLE_PEOPLE, NOW)!;
    expect(owed.text).toBe('You owe Sarah the revised pricing deck, 4 days late. You promised it in Pricing review on 26 Oct.');
    expect(card).toMatchObject({ itemIds: ['d-team-12', 'i-q3'], meetingId: M.review, atMs: mmss(31, 4) });
  });

  it('searches keyword-only without a model, skips this meeting and items already shown', async () => {
    const search = vi.fn(async (): Promise<SearchResult> => ({ mode: 'keyword', items: [{ item: item('d-team-12'), score: 1 }, { item: item('i-deck'), score: 0.5 }], meetings: [] }));
    const query = 'What about the team plan, is it twelve a seat?';
    const card = await findRecall(M.sarah3, query, new Set(), { search, meetings: SAMPLE_MEETINGS, people: SAMPLE_PEOPLE, now: NOW });
    expect(card?.text).toBe('On 26 Oct you decided $12 a seat.');
    const opts = (search.mock.calls[0] as unknown as [string, { meetings: { id: string }[]; itemFilter: (i: unknown) => boolean; load: (m: unknown) => Promise<{ segments: unknown[]; notes: unknown[] }> }])[1];
    expect(opts.meetings.some((m) => m.id === M.sarah3)).toBe(false);
    // No meeting's transcript is read on the live tick.
    expect(await opts.load(SAMPLE_MEETINGS[0])).toMatchObject({ segments: [], notes: [] });
    expect(await findRecall(M.sarah3, query, new Set(['d-team-12']), { search, meetings: SAMPLE_MEETINGS, people: SAMPLE_PEOPLE, now: NOW })).toBeUndefined();
  });

  it('queries the last minute of the transcript', () => {
    expect(recentText(ONE_ON_ONE, mmss(16, 40))).toBe('Now the Northwind rollout date. Can you send the deck today? For the rollout date, the 9th is still the plan.');
  });
});

describe('agenda tracking', () => {
  it('matches lines that name an item', () => {
    expect(mentions({ text: 'Q3 usage numbers' }, 'The Q3 numbers are late')).toBe(true);
    expect(mentions({ text: 'Revised pricing deck' }, 'Can you send the deck today?')).toBe(false);
  });

  it('ticks covered items at their last mention and times the current one', () => {
    const t = trackAgenda(SAMPLE_AGENDA, ONE_ON_ONE, mmss(18, 42));
    expect(t.rows.map((r) => [r.item.text, r.state, r.coveredAtMs])).toEqual([
      ['Q3 usage numbers', 'covered', mmss(4, 10)],
      ['Revised pricing deck', 'covered', mmss(12, 30)],
      ['Northwind rollout date', 'current', undefined],
      ['Seat count for the rollout', 'next', undefined],
    ]);
    expect(t.place).toBe(3);
    expect(t.total).toBe(4);
    expect(minutesLeft(t.leftMs!)).toBe('2 min left');
    expect(t.used).toBeCloseTo(0.6);
  });

  it('a single passing mention does not cover an item', () => {
    const t = trackAgenda(SAMPLE_AGENDA, [
      seg(0, 20, 'Q3 usage numbers first?'),
      seg(1, 0, 'Actually, the revised pricing deck.'),
      seg(1, 30, 'The pricing deck is nearly done.'),
    ], mmss(2, 0));
    expect(t.rows.map((r) => r.state)).toEqual(['open', 'current', 'next', 'open']);
  });

  it('starts on the first item, and a skip moves on', () => {
    const t = trackAgenda(SAMPLE_AGENDA, [], 60_000);
    expect(t.current?.text).toBe('Q3 usage numbers');
    const skipped = trackAgenda(skipItem(SAMPLE_AGENDA, 'a-q3'), [], 60_000);
    expect(skipped.rows[0]!.state).toBe('skipped');
    expect(skipped.current?.text).toBe('Revised pricing deck');
  });

  it('brings a skipped item back, and only that one', () => {
    const both = skipItem(skipItem(SAMPLE_AGENDA, 'a-q3'), 'a-seats');
    const back = bringBack(both, 'a-q3');
    expect(back.items.map((i) => !!i.skipped)).toEqual([false, false, false, true]);
    expect(trackAgenda(back, [], 60_000).current?.text).toBe('Q3 usage numbers');
  });
});

describe('questions for you', () => {
  it('finds questions someone else put to you and makes your promise from one', () => {
    const qs = questionsForYou(ONE_ON_ONE, () => 'Sarah');
    expect(qs).toEqual([{ id: 's-16-5:0', speaker: 'Sarah', text: 'Can you send the deck today?', atMs: mmss(16, 5) }]);
    expect(promiseText(qs[0]!.text)).toBe('Send the deck today');
    expect(promiseFromQuestion(qs[0]!, M.sarah3, NOW, 'p-sarah', () => 'n1')).toMatchObject({
      id: 'n1', kind: 'promise', status: 'open', ownerId: 'me', toId: 'p-sarah', personIds: ['p-sarah'],
      quote: { speaker: 'Sarah', text: 'Can you send the deck today?', meetingId: M.sarah3, atMs: mmss(16, 5) },
    });
  });
});

describe('what did I miss', () => {
  it('sends only the chosen minutes and records one ledger entry', async () => {
    const fetch = reply('{"lines":[{"atMs":"15:42","text":"Rollout date is next."},{"atMs":996000,"text":"Sarah asked for the deck."},{"atMs":990000,"text":"You kept the 9th."}],"forYou":"“Sarah asked for the deck today.”"}');
    const record = vi.fn(noRecord);
    const r = await whatDidIMiss({ id: M.sarah3 }, ONE_ON_ONE, 3, mmss(18, 42), { config: AI, fetch, record });
    expect(r).toEqual({ status: 'ok', missed: { lines: [{ atMs: mmss(15, 42), text: 'Rollout date is next.' }, { atMs: 996000, text: 'Sarah asked for the deck.' }, { atMs: 990000, text: 'You kept the 9th.' }], forYou: 'Sarah asked for the deck today.' } });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { messages: { content: string }[] };
    expect(body.messages[1]!.content).toContain('Now the Northwind rollout date.');
    expect(body.messages[1]!.content).not.toContain('Q3 usage numbers');
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'groq', what: MISSED_LEDGER_WHAT });
  });

  it('keeps the window and reads bad replies as none', () => {
    expect(missedWindow(ONE_ON_ONE, 3, mmss(18, 42)).map((s) => s.startMs)).toEqual([mmss(15, 42), mmss(16, 5), mmss(16, 30), mmss(18, 36)]);
    expect(parseMissed('no json')).toBeUndefined();
  });
});

describe('clash', () => {
  const line = seg(18, 40, 'Let’s move the rollout to the 16th.', 'others', { id: 'clash' });
  it('picks lines that change an open decision, then the AI confirms and words it', async () => {
    const decisions = SAMPLE_ITEMS.filter((i) => i.kind === 'decision');
    const [c] = clashCandidates(decisions, [seg(18, 14, 'The 9th still works on our side.', 'you'), line]);
    expect(c?.decision.id).toBe('d-rollout-9');
    const record = vi.fn(noRecord);
    const found = await confirmClash(M.sarah3, c!, 'Sarah', '27 Oct', { config: AI, record, fetch: reply('{"changes": true, "decision": "Northwind rollout starts 16 Nov"}') });
    expect(found?.newText).toBe('Northwind rollout starts 16 Nov');
    expect(record).toHaveBeenCalledWith({ meetingId: M.sarah3, service: 'groq', what: 'Clash checks' });
    expect(replacingDecision(found!, M.sarah3, NOW, () => 'd-new')).toMatchObject({ id: 'd-new', kind: 'decision', status: 'open', quote: { speaker: 'Sarah', atMs: mmss(18, 40) } });
    expect(parseClash('{"changes": false}')).toEqual({ changes: false });
  });
});

describe('off the record', () => {
  const START = 1_000_000;
  it('stamps the span at the click and drops any chunk with audio from after it', async () => {
    let t = START + mmss(18, 42);
    const calls: string[] = [];
    const gate = new OffRecordGate(START, { stop: async (cut) => { calls.push(`stop ${cut}`); }, start: async () => { calls.push('start'); } }, () => t);
    expect(gate.keep({ startMs: mmss(18, 30), endMs: mmss(18, 40) })).toBe(true);
    const click = START + mmss(18, 42);
    t += 1_200; // the switch reaches the recorder a moment after the click
    await gate.set(true, click);
    expect(gate.off).toBe(true);
    expect(calls).toEqual([`stop ${mmss(18, 42)}`]);
    // The chunk in flight at the click ends after it: dropped, even by a few ms.
    expect(gate.keep({ startMs: mmss(18, 40), endMs: mmss(18, 42) + 1 })).toBe(false);
    expect(gate.keep({ startMs: mmss(18, 32), endMs: mmss(18, 42) })).toBe(true);
    expect(gate.keep({ startMs: mmss(18, 42), endMs: mmss(18, 52) })).toBe(false);
    t += mmss(2, 0);
    await gate.set(false, START + mmss(20, 42));
    expect(calls).toEqual([`stop ${mmss(18, 42)}`, 'start']);
    expect(gate.keep({ startMs: mmss(19, 0), endMs: mmss(19, 10) })).toBe(false);
    expect(gate.keep({ startMs: mmss(20, 40), endMs: mmss(20, 43) })).toBe(false);
    expect(gate.keep({ startMs: mmss(20, 42), endMs: mmss(20, 52) })).toBe(true);
  });

  it('judges chunks against the click at once, while capture is still stopping', async () => {
    let release: (() => void) | undefined;
    const gate = new OffRecordGate(START, { stop: () => new Promise<void>((r) => { release = r; }), start: async () => undefined }, () => START + mmss(5, 0));
    const switching = gate.set(true, START + mmss(1, 0));
    // A chunk finished by the recorder before the switch runs, with audio past the click: dropped.
    expect(gate.keep({ startMs: mmss(0, 55), endMs: mmss(1, 0) + 300 })).toBe(false);
    while (!release) await Promise.resolve();
    release();
    await switching;
    expect(gate.keep({ startMs: mmss(0, 50), endMs: mmss(1, 0) })).toBe(true);
  });

  it('audio from after the click never reaches storage or the transcription queue', async () => {
    let t = START;
    const saved: Chunk[] = [];
    const queued: string[] = [];
    let n = 0;
    const capture = { stop: async () => { await chunker.stop(); }, start: async () => undefined };
    const gate = new OffRecordGate(START, capture, () => t);
    const hooks = gatedChunks((c) => gate.keep(c), async (c) => { saved.push(c); }, (id) => queued.push(id));
    const chunker: Chunker = new Chunker({
      meetingId: 'm', speaker: 'you', startedAt: START, now: () => t, newId: () => `c${++n}`,
      createRecorder: () => ({ mimeType: 'audio/webm', start: () => undefined, stop: async () => new Blob(['x']) }),
      ...hooks,
    });
    chunker.start();
    t = START + 10_000;
    await chunker.tick(0.5); // c1: 0–10 s, before the click
    t = START + 12_000;
    await chunker.tick(0.5);
    const click = t;
    t += 400; // the switch reaches the recorder after the click: c2 (10–12.4 s) holds audio from after it
    await gate.set(true, click);
    expect(saved.map((c) => [c.id, c.startMs, c.endMs])).toEqual([['c1', 0, 10_000]]);
    expect(queued).toEqual(['c1']);
  });

  it('keeps spans in meeting time and labels them', () => {
    const off = goOff(undefined, START + 1000);
    expect(off.since).toBe(START + 1000);
    const on = goOn(off, START + 1000 + mmss(2, 0), START);
    expect(on).toEqual({ spans: [{ startMs: 1000, endMs: 1000 + mmss(2, 0) }] });
    expect(spanLabel(on.spans[0]!)).toBe('Off the record · 2 min');
    expect(offClock(START, START + 11_000)).toBe('00:11');
    expect(inOffSpan({ startMs: 0, endMs: 900 }, on.spans)).toBe(false);
  });
});
