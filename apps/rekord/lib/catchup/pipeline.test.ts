import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { citationCaption, buildMemoryMessages, parseSources } from '../askAll';
import { closeDB, getMeeting, listSegments, putMeeting, putSegment, saveTypedPart } from '../db';
import { meetingMarkdown } from '../folder/markdown';
import { lastTimeMessages } from '../memory/brief';
import {
  buildExtractPrompt, estimateTokens, EXTRACT_SYSTEM, extractMeeting, extractSystem, LEDGER_WHAT, MAX_CALL_TOKENS, MAX_NOT_PROMISES, MAX_OPEN_PROMISES,
  MAX_PART_TOKENS, REPLY_TOKENS,
} from '../memory/extract';
import { itemsForMeeting, listLedger } from '../memory/store';
import { saveKeys } from '../penv';
import { CATCHUP_EMAIL_LINE, followUpFacts, plainDraft, withCatchupLine } from '../services/followUp';
import { SYSTEM as SUMMARY_SYSTEM } from '../summarize';
import type { Meeting, Segment } from '../types';
import { catchupPreamble } from './preamble';
import { askQuestions, catchupProgress, finishCatchup, QUESTIONS_LEDGER_WHAT, readQuestions, skipQuestion } from './pipeline';
import { QUESTIONS_SYSTEM } from './questions';

const START = new Date(2026, 10, 2, 13, 0).getTime();
const TOLD_AT = new Date(2026, 10, 2, 17, 10).getTime();
const reply = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
type Body = { messages: { role: string; content: string }[]; max_tokens?: number };

/** A fake AI that answers by the call's instructions and keeps every request body. */
function fakeAI(over: { questions?: unknown } = {}) {
  const bodies: Body[] = [];
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as Body;
    bodies.push(body);
    const system = body.messages[0]!.content;
    if (system.includes(QUESTIONS_SYSTEM)) return reply(over.questions ?? { questions: [{ text: 'You will send the Q4 plan draft. By when?', about: 'due' }] });
    if (system.includes(EXTRACT_SYSTEM)) {
      return reply({ items: [
        { kind: 'promise', text: 'Send the Q4 plan draft', quote: 'I will send Sarah the Q4 plan draft', speaker: 'You', atMs: 0, owner: 'You', to: 'Sarah Chen' },
        { kind: 'decision', text: 'Invented', quote: 'words nobody said', speaker: 'You', atMs: 0 },
      ], done: [] });
    }
    if (system.includes(SUMMARY_SYSTEM)) return reply({ overview: 'Q4 planning.', decisions: [], actions: [], questions: [] });
    return reply({ relation: 'different' });
  });
  return { f, bodies, calls: (s: string) => bodies.filter((b) => b.messages[0]!.content.includes(s)) };
}

const seg = (meetingId: string, id: string, startMs: number, text: string): Segment =>
  ({ id, meetingId, speaker: 'you', startMs, endMs: startMs + 5_000, text, chunkId: id });
const EVENT = { id: 'e1', title: 'Q4 planning with Northwind', start: START, end: START + 4 * 3_600_000, attendees: [{ email: 'me@x.co', self: true }, { name: 'Sarah Chen', email: 'sarah@northwind.co' }] };

async function meeting(id: string, source: Meeting['source'], segments: string[] = ['I will send Sarah the Q4 plan draft.', 'The pilot starts with the Support team.']) {
  const told = { at: TOLD_AT, ms: segments.length * 10_000, parts: [{ at: TOLD_AT, ms: segments.length * 10_000, kind: 'voice' as const }] };
  await putMeeting({
    id, title: 'Q4 planning with Northwind', startedAt: START, endedAt: START + 4 * 3_600_000, status: 'processing', language: 'en', event: EVENT,
    ...(source && { source }), ...(source === 'catchup' && { told }),
  });
  for (const [n, text] of segments.entries()) await putSegment(seg(id, `${id}-${n}`, n * 10_000, text));
}

beforeEach(async () => {
  fakeBrowser.reset();
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
});

/** Every call, prompt and reply allowance together, is under the 8,000-token budget. */
const underBudget = (bodies: Body[]) => {
  for (const b of bodies) expect(b.messages.reduce((n, m) => n + estimateTokens(m.content), 0) + (b.max_tokens ?? 0)).toBeLessThan(MAX_CALL_TOKENS);
};

describe('a catch-up and a recording through the same pipeline', () => {
  async function run(source: Meeting['source']) {
    await meeting('m', source);
    const ai = fakeAI();
    await finishCatchup('m', { fetchFn: ai.f });
    await extractMeeting('m', { fetchFn: ai.f, now: () => 1 });
    return { ai, items: await itemsForMeeting('m') };
  }

  it('differs only by the preamble, and items still need a quote found in the telling', async () => {
    const rec = await run(undefined);
    fakeBrowser.reset();
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await saveKeys({ GROQ_API_KEY: 'gsk_test' });
    const cat = await run('catchup');
    const preamble = catchupPreamble(START);
    expect(preamble).toContain('Work out dates from the meeting date 2026-11-02');

    for (const kind of [SUMMARY_SYSTEM, EXTRACT_SYSTEM]) {
      const [r] = rec.ai.calls(kind);
      const [c] = cat.ai.calls(kind);
      expect(r!.messages[0]!.content).toBe(kind);
      expect(c!.messages[0]!.content).toBe(`${preamble}\n${kind}`);
      expect(c!.messages.slice(1)).toEqual(r!.messages.slice(1));
    }
    expect(cat.ai.calls(QUESTIONS_SYSTEM)).toHaveLength(0); // questions come after a telling stops, not here
    const strip = (items: typeof cat.items) => items.map(({ id: _, personIds: __, ownerId: ___, toId: ____, ...rest }) => rest).sort((a, b) => a.text.localeCompare(b.text));
    expect(strip(cat.items)).toEqual(strip(rec.items));
    expect(cat.items.map((i) => [i.text, i.status, !!i.leftOut]).sort()).toEqual([['Invented', 'suggested', true], ['Send the Q4 plan draft', 'suggested', false]]);
    underBudget(cat.ai.bodies);
  });

  it('keeps the biggest catch-up extraction call, with its preamble, under 8,000 tokens', () => {
    const user = buildExtractPrompt({
      title: 'T'.repeat(200), date: '2026-11-02', lines: ['会'.repeat(MAX_PART_TOKENS)],
      open: Array.from({ length: MAX_OPEN_PROMISES }, () => ({ text: 'y'.repeat(150) })),
      notPromises: Array.from({ length: MAX_NOT_PROMISES }, () => ({ text: 'z'.repeat(100), quote: { speaker: '', text: 'q'.repeat(150), meetingId: '', atMs: 0 } })),
    });
    expect(estimateTokens(extractSystem({ source: 'catchup', startedAt: START }) + user) + REPLY_TOKENS).toBeLessThan(MAX_CALL_TOKENS);
  });

  it('keeps a 60-minute telling under 8,000 tokens per call', async () => {
    const words = 'we went through the pilot plan and Sarah said the Support team goes first with Tom on admin access and budgets'.split(' ');
    const lines = Array.from({ length: 360 }, (_, n) => `${n}: ${words.join(' ')} ${words.slice(0, 6).join(' ')}.`);
    await meeting('m', 'catchup', lines);
    const ai = fakeAI();
    await askQuestions('m', { fetchFn: ai.f });
    await finishCatchup('m', { fetchFn: ai.f });
    await extractMeeting('m', { fetchFn: ai.f });
    expect(ai.calls(SUMMARY_SYSTEM)).toHaveLength(1);
    expect(ai.calls(EXTRACT_SYSTEM).length).toBeGreaterThan(5);
    underBudget(ai.bodies);
  });
});

describe('follow-up questions', () => {
  it('asks once after the draft, with one ledger entry, and extraction reuses the draft', async () => {
    await meeting('c', 'catchup');
    const ai = fakeAI();
    const state = await askQuestions('c', { fetchFn: ai.f });
    expect(state).toMatchObject({ status: 'ready', questions: [{ id: 'q1', text: 'You will send the Q4 plan draft. By when?', about: 'due' }] });
    expect(await readQuestions('c')).toEqual(state);
    expect(ai.calls(QUESTIONS_SYSTEM)).toHaveLength(1);
    expect(ai.calls(QUESTIONS_SYSTEM)[0]!.messages[1]!.content).toContain('Promise with no due date');
    expect(await listLedger()).toEqual(expect.arrayContaining([
      expect.objectContaining({ meetingId: 'c', what: QUESTIONS_LEDGER_WHAT, count: 1 }),
      expect.objectContaining({ meetingId: 'c', what: LEDGER_WHAT, count: 1 }),
    ]));
    expect(await askQuestions('c', { fetchFn: ai.f })).toEqual(state); // kept, not asked again

    await skipQuestion('c', 'q1');
    expect((await getMeeting('c'))?.told?.answers).toEqual([{ questionId: 'q1', skipped: true }]);
    await extractMeeting('c', { fetchFn: ai.f });
    expect(ai.calls(EXTRACT_SYSTEM)).toHaveLength(1); // nothing changed since the draft
  });

  it('asks again only for the part an answer changed', async () => {
    await meeting('c', 'catchup');
    const ai = fakeAI();
    await askQuestions('c', { fetchFn: ai.f });
    const picked = { kind: 'event' as const, event: EVENT };
    await saveTypedPart({ meetingId: 'c', picked, append: true, questionId: 'q1' }, 'By Friday.', 'en', TOLD_AT + 60_000, () => crypto.randomUUID());
    expect((await listSegments('c')).at(-1)).toMatchObject({ speaker: 'you', text: 'By Friday.', startMs: 20_000 });
    await extractMeeting('c', { fetchFn: ai.f });
    expect(ai.calls(EXTRACT_SYSTEM)).toHaveLength(2);
    expect(ai.calls(EXTRACT_SYSTEM)[1]!.messages[1]!.content).toContain('By Friday.');
  });

  it('makes no questions call when nothing is missing, and fails softly on a rate limit', async () => {
    await meeting('c', 'catchup');
    const covered = { kind: 'promise', text: 'Send the Q4 plan draft', quote: 'q', speaker: 'You', atMs: 0, owner: 'You', to: 'Sarah Chen', due: '2026-11-04' };
    const none = vi.fn(async () => reply({ items: [covered], done: [] }));
    expect(await askQuestions('c', { fetchFn: none })).toEqual({ status: 'ready', questions: [] });
    expect(none).toHaveBeenCalledTimes(1);

    await meeting('d', 'catchup');
    const limited = await askQuestions('d', { fetchFn: async () => new Response('{}', { status: 429 }) });
    expect(limited).toMatchObject({ status: 'failed', failed: 'limit' });
    expect((await catchupProgress('d')).steps[1]).toMatchObject({ step: 'questions', done: false, failed: 'limit' });
  });

  it('never asks for a recording', async () => {
    await meeting('r', undefined);
    const ai = fakeAI();
    expect(await askQuestions('r', { fetchFn: ai.f })).toEqual({ status: 'ready', questions: [] });
    expect(ai.f).not.toHaveBeenCalled();
  });

  it('shows each processing step', async () => {
    await meeting('c', 'catchup');
    const ai = fakeAI();
    await askQuestions('c', { fetchFn: ai.f });
    expect((await catchupProgress('c')).steps.map((s) => s.done)).toEqual([true, true, false, false, false]);
    await finishCatchup('c', { fetchFn: ai.f });
    await extractMeeting('c', { fetchFn: ai.f });
    expect(await catchupProgress('c')).toEqual({
      steps: [
        { step: 'text', done: true }, { step: 'questions', done: true }, { step: 'decisions', done: true },
        { step: 'promises', done: true }, { step: 'summary', done: true },
      ],
      decisions: 0, promises: 1,
    });
  });
});

describe('catch-up wording (FRAMES V41Items)', () => {
  const catchup: Meeting = {
    id: 'c', title: 'Q4 planning with Northwind', startedAt: START, endedAt: START + 4 * 3_600_000, status: 'done', language: 'en', event: EVENT,
    source: 'catchup', told: { at: TOLD_AT, ms: 760_000, parts: [] },
  };
  const recording: Meeting = { ...catchup, source: undefined, told: undefined };

  it('adds the two header lines to the Rekord folder note', () => {
    const md = (m: Meeting) => meetingMarkdown({ meeting: m, segments: [], notes: [], markers: [], items: [] }, new Map());
    expect(md(catchup)).toContain('# Q4 planning with Northwind\n\nMon 2 Nov · 13:00 · 4 h · Catch up  \nFrom your catch-up, told 2 Nov, 17:10 · 12:40\n');
    expect(md(recording)).not.toContain('catch-up');
  });

  it('adds the line to the follow-up email, and puts it back if the AI drops it', () => {
    const facts = followUpFacts(catchup, [], [], { now: START });
    expect(plainDraft(facts, 'short').split('\n\n')).toEqual(['Hi Sarah,', 'Thanks for today.', CATCHUP_EMAIL_LINE]);
    expect(plainDraft(followUpFacts(recording, [], [], { now: START }), 'short')).not.toContain(CATCHUP_EMAIL_LINE);
    expect(withCatchupLine('Hi Sarah,\n\nThanks for today.\n\nAlex')).toBe(`Hi Sarah,\n\nThanks for today.\n\n${CATCHUP_EMAIL_LINE}\n\nAlex`);
  });

  it('captions Ask all citations and tells the AI where a fact came from', () => {
    const [s] = parseSources('Yes [c@0:20].', [catchup]);
    expect(s).toMatchObject({ meetingId: 'c', catchup: true });
    expect(citationCaption(s!)).toBe('From your catch-up');
    expect(citationCaption({ atMs: 20_000 })).toBe('00:20');
    expect(buildMemoryMessages([], 'q', true)[0]!.content).toContain('say it comes from their catch-up');
    expect(buildMemoryMessages([], 'q')[0]!.content).not.toContain('catch-up');
  });

  it('tells the brief that the last meeting was a catch-up', () => {
    const msgs = lastTimeMessages({ id: 'c', title: catchup.title, startedAt: START, source: 'catchup' }, undefined, [], []);
    expect(msgs[1]!.content).toContain('from your catch-up');
    expect(lastTimeMessages({ id: 'c', title: catchup.title, startedAt: START }, undefined, [], [])[1]!.content).not.toContain('catch-up');
  });
});
