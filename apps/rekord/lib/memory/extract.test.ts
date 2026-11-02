import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDB, putMeeting, putSegment } from '../db';
import { saveKeys } from '../penv';
import { summarize } from '../summarize';
import type { Segment } from '../types';
import {
  buildExtractPrompt, estimateTokens, extractMeeting, EXTRACT_SYSTEM, LEDGER_WHAT, MAX_NOT_PROMISES, MAX_OPEN_PROMISES, MAX_CALL_TOKENS,
  MAX_PART_CHARS, parseExtraction, parseRelation, REPLY_TOKENS, resolvePeople, similarity, splitParts,
} from './extract';
import { mergeSuggestions } from './link';
import { getItem, itemsForMeeting, listLedger, listPeople, putItem, putPerson } from './store';
import type { MemoryItem } from './types';

const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }), { status: 200 });
const seg = (id: string, startMs: number, text: string, speaker: Segment['speaker'] = 'you', speakerLabel?: string): Segment =>
  ({ id, meetingId: 'm2', speaker, speakerLabel, startMs, endMs: startMs + 5000, text, chunkId: id });
const body = (f: ReturnType<typeof vi.fn>, i: number) =>
  JSON.parse((f.mock.calls[i] as unknown as [string, RequestInit])[1].body as string) as { messages: { content: string }[] };
const item = (over: Partial<MemoryItem>): MemoryItem => ({
  id: 'i1', kind: 'promise', status: 'open', text: 'Send the revised pricing deck', meetingId: 'm1', personIds: [], history: [],
  quote: { speaker: 'You', text: 'I will send the revised pricing deck', meetingId: 'm1', atMs: 1000 }, createdAt: 1, updatedAt: 1, ...over,
});

beforeEach(async () => {
  fakeBrowser.reset();
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
  await putMeeting({ id: 'm1', title: 'Pricing sync', startedAt: Date.UTC(2026, 9, 1), status: 'done', language: 'en' });
  await putMeeting({
    id: 'm2', title: '1:1 with Sarah', startedAt: Date.UTC(2026, 10, 3, 10), status: 'done', language: 'en',
    speakers: { A: { name: 'Sarah Chen' } },
    event: { id: 'e', title: '1:1', start: 0, end: 1, attendees: [{ email: 'me@x.co', self: true }, { name: 'Sarah Chen', email: 'sarah@northwind.co' }] },
  });
  for (const s of [
    seg('a', 60_000, "I'll send the revised pricing deck by Friday."),
    seg('b', 120_000, "Let's go with the annual plan for Northwind.", 'others', 'A'),
    seg('c', 180_000, 'I already sent the onboarding checklist yesterday.', 'others', 'A'),
  ]) await putSegment(s);
});

describe('parseExtraction', () => {
  it('reads fenced JSON, clock times and drops bad entries', () => {
    const out = parseExtraction('```json\n{"items":[{"kind":"Promise","text":" Send deck ","quote":"send the deck","speaker":"You","atMs":"1:05","due":"2026-11-06","owner":"You"},' +
      '{"kind":"idea","text":"x","quote":"y"},{"kind":"decision","text":"no quote"},{"kind":"question","text":"q","quote":"q?","due":"Friday"},3],' +
      '"done":[{"ref":"2","quote":"done it","speaker":"Sam","atMs":5000},{"ref":0,"quote":"x"},{"ref":1}]}\n```');
    expect(out.items).toEqual([
      { kind: 'promise', text: 'Send deck', quote: 'send the deck', speaker: 'You', atMs: 65_000, owner: 'You', to: undefined, due: '2026-11-06' },
      { kind: 'question', text: 'q', quote: 'q?', speaker: '', atMs: undefined, owner: undefined, to: undefined, due: undefined },
    ]);
    expect(out.done).toEqual([{ ref: 2, quote: 'done it', speaker: 'Sam', atMs: 5000 }]);
  });
  it('accepts a bare array and never throws on junk', () => {
    expect(parseExtraction('Here: [{"kind":"decision","text":"d","quote":"q"}]').items).toHaveLength(1);
    expect(parseExtraction('no json at all')).toEqual({ items: [], done: [] });
    expect(parseExtraction('{"items": "nope"}')).toEqual({ items: [], done: [] });
    expect(parseRelation('{"relation":"Replaces"}')).toBe('replaces');
    expect(parseRelation('???')).toBe('different');
  });
});

describe('parts and limits', () => {
  it('splits into 10-minute parts and cuts long parts', () => {
    const segs = [0, 5, 9, 10, 25].map((min, i) => seg(`s${i}`, min * 60_000, 'hello there'));
    expect(splitParts(segs).map((p) => p.segments.length)).toEqual([3, 1, 1]);
    const long = Array.from({ length: 40 }, (_, i) => seg(`l${i}`, i * 1000, 'x'.repeat(1000)));
    const parts = splitParts(long);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.segments.length * 1000 <= MAX_PART_CHARS)).toBe(true);
  });
  it('keeps the biggest call under 8,000 tokens', () => {
    const user = buildExtractPrompt({
      title: 'T'.repeat(200), date: '2026-11-03', lines: ['x'.repeat(MAX_PART_CHARS)],
      open: Array.from({ length: MAX_OPEN_PROMISES }, () => ({ text: 'y'.repeat(150) })),
      notPromises: Array.from({ length: MAX_NOT_PROMISES }, () => item({ text: 'z'.repeat(100), quote: { speaker: '', text: 'q'.repeat(150), meetingId: '', atMs: 0 } })),
    });
    expect(estimateTokens(EXTRACT_SYSTEM + user) + REPLY_TOKENS).toBeLessThan(MAX_CALL_TOKENS);
  });
});

describe('people', () => {
  it('links attendees by email first and leaves loose names for "Is Sam Sam Ortiz?"', () => {
    const sam = { id: 'p-sam', name: 'Sam Ortiz', email: 'sam@x.co', aliases: [], meetingIds: [], createdAt: 0, updatedAt: 0 };
    let n = 0;
    const plan = resolvePeople([{ name: 'S. Ortiz', email: 'sam@x.co' }], ['Sam', 'You', 'Speaker B', 'Dana Ruiz'], [sam], 'm', 5, () => `new${n++}`);
    expect(plan.byName.get('s. ortiz')).toBe('p-sam');
    expect(plan.changed.find((p) => p.id === 'p-sam')).toMatchObject({ aliases: ['S. Ortiz'], meetingIds: ['m'] });
    expect(plan.created).toBe(2);
    expect(plan.byName.has('you')).toBe(false);
    expect(mergeSuggestions(plan.people).map(([a, b]) => [a.name, b.name])).toContainEqual(['Sam', 'Sam Ortiz']);
    expect(similarity('Send the revised pricing deck', 'Send the pricing deck')).toBeGreaterThan(0.6);
  });
});

describe('extractMeeting', () => {
  it('saves checked items as suggested, keeps failures as left out, and records one ledger entry per call', async () => {
    await putItem(item({ id: 'dis', status: 'dismissed', dismissReason: 'notAPromise', text: 'Think about lunch', meetingId: 'm1' }));
    const f = vi.fn(async () => reply({
      items: [
        { kind: 'promise', text: 'Send the revised pricing deck', quote: "I'll send the revised pricing deck by Friday", speaker: 'You', atMs: 60_000, owner: 'You', to: 'Sarah Chen', due: '2026-11-06' },
        { kind: 'decision', text: 'Northwind goes annual', quote: "Let's go with the annual plan for Northwind", speaker: 'Sarah Chen', atMs: 120_000 },
        { kind: 'question', text: 'Who pays for travel?', quote: 'Who is paying for the travel', speaker: 'Sarah Chen', atMs: 120_000 },
      ],
      done: [],
    }));
    const out = await extractMeeting('m2', { fetchFn: f, now: () => 99 });
    expect(out).toMatchObject({ found: 2, promises: 1, decisions: 1, questions: 0, leftOut: 1, people: 1 });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    expect(body(f, 0).messages[1]!.content).toContain('- Think about lunch ("I will send the revised pricing deck")');
    expect(body(f, 0).messages[1]!.content).toContain('Meeting date: 2026-11-03');

    const saved = await itemsForMeeting('m2');
    const sarah = (await listPeople()).find((p) => p.email === 'sarah@northwind.co')!;
    const promise = saved.find((i) => i.kind === 'promise')!;
    expect(promise).toMatchObject({ status: 'suggested', ownerId: 'me', toId: sarah.id, personIds: [sarah.id], due: '2026-11-06' });
    expect(promise.leftOut).toBeUndefined();
    expect(saved.find((i) => i.kind === 'question')).toMatchObject({ leftOut: true, status: 'suggested' });
    expect(sarah.meetingIds).toEqual(['m2']);
    expect(await listLedger()).toMatchObject([{ meetingId: 'm2', service: 'groq', what: LEDGER_WHAT, count: 1 }]);

    expect(await extractMeeting('m2', { fetchFn: f })).toMatchObject({ found: 0 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('marks an earlier promise as looks done with evidence, never done', async () => {
    await putItem(item({ id: 'old', text: 'Send the onboarding checklist' }));
    const f = vi.fn(async () => reply({ items: [], done: [{ ref: 1, quote: 'I already sent the onboarding checklist', speaker: 'Sarah Chen', atMs: 180_000 }, { ref: 7, quote: 'x' }] }));
    const out = await extractMeeting('m2', { fetchFn: f, now: () => 50 });
    expect(out.looksDone).toBe(1);
    expect(body(f, 0).messages[1]!.content).toContain('1. Send the onboarding checklist');
    expect(await getItem('old')).toMatchObject({ status: 'looksDone', evidence: { meetingId: 'm2', atMs: 180_000, speaker: 'Sarah Chen' } });
  });

  it('skips looks done when the evidence quote is not in the transcript', async () => {
    await putItem(item({ id: 'old', text: 'Send the onboarding checklist' }));
    await extractMeeting('m2', { fetchFn: async () => reply({ items: [], done: [{ ref: 1, quote: 'the invoice is paid now', atMs: 180_000 }] }) });
    expect((await getItem('old'))?.status).toBe('open');
  });

  it('links a repeat to the earlier promise and a changed decision as replacing it', async () => {
    await putItem(item({ id: 'old' }));
    await putItem(item({ id: 'dec', kind: 'decision', text: 'Northwind goes monthly plan', status: 'open' }));
    await putPerson({ id: 'p-sarah', name: 'Sarah Chen', email: 'sarah@northwind.co', aliases: [], meetingIds: ['m1'], createdAt: 0, updatedAt: 0 });
    const f = vi.fn()
      .mockResolvedValueOnce(reply({ items: [
        { kind: 'promise', text: 'Send the pricing deck', quote: "I'll send the revised pricing deck by Friday", speaker: 'You', atMs: 60_000 },
        { kind: 'decision', text: 'Northwind goes annual plan', quote: "Let's go with the annual plan for Northwind", speaker: 'Sarah Chen', atMs: 120_000 },
      ] }))
      .mockResolvedValueOnce(reply('{"relation":"same"}'))
      .mockResolvedValueOnce(reply('{"relation":"replaces"}'));
    const out = await extractMeeting('m2', { fetchFn: f });
    expect(f).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ found: 1, decisions: 1, promises: 0, people: 0 });
    expect((await getItem('old'))?.history).toHaveLength(1);
    expect(await itemsForMeeting('m2')).toMatchObject([{ kind: 'decision', replacesId: 'dec', personIds: ['p-sarah'] }]);
    expect((await getItem('dec'))?.status).toBe('open');
    expect((await listLedger())[0]?.count).toBe(3);
  });

  it('saves nothing when a call fails part way', async () => {
    await expect(extractMeeting('m2', { fetchFn: async () => new Response('{}', { status: 429 }) })).rejects.toMatchObject({ code: 'rate-limited' });
    expect(await itemsForMeeting('m2')).toEqual([]);
    expect(await listPeople()).toEqual([]);
  });
});

describe('after the summary', () => {
  it('runs extraction and never breaks the summary', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = vi.fn()
      .mockResolvedValueOnce(reply('{"overview":"o","decisions":[],"actions":[],"questions":[]}'))
      .mockRejectedValueOnce(new TypeError('offline'));
    const m = await summarize('m2', f);
    expect(m.summary?.overview).toBe('o');
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Rekord: could not extract memory', expect.anything()));
    expect(f).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
