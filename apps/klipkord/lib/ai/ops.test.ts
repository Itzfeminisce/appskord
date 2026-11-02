import { describe, expect, it, vi } from 'vitest';
import { chat, PROVIDERS, type ChatMessage, type FetchLike } from '../llm';
import { currentCut, steps, undo } from '../project/history';
import { fromRecording } from '../project/migrate';
import { cutLength } from '../project/time';
import type { Project } from '../project/types';
import type { Recording } from '../types';
import type { Unit } from '../wordCuts';
import { AiError, applyDraft, askOps, checkReply, draftSpans, draftWords, MAX_TEXT, parseReply, toDraft, toggleChange, type Call } from './ops';
import { chunkTranscript, MAX_CALL_TOKENS, MAX_PROBLEMS, REPLY_TOKENS, repairUser, sentences, tokens } from './prompt';

const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [] } as unknown as Recording;
const base = (): Project => fromRecording(rec);
const units: Unit[] = ['Hi,', "I'm", 'Sam.', 'Um,', 'then', 'pick', 'Members.'].map((text, i) => ({ start: i * 1000, end: i * 1000 + 600, text, line: 0 }));
const ctx = { words: units.length, cards: false };

/** An injected fetch that answers with these replies in turn, OpenAI style. */
function replies(...contents: unknown[]) {
  const queue = contents.map((c) => (typeof c === 'string' ? c : JSON.stringify(c)));
  return vi.fn<FetchLike>(async () => new Response(JSON.stringify({ choices: [{ message: { content: queue.shift() ?? '{}' } }] })));
}
const callWith = (fetchFn: FetchLike): Call => (messages: ChatMessage[], { maxTokens }) =>
  chat(messages, { json: true, maxTokens, keys: { [PROVIDERS.groq.keyName]: 'gsk_test' } }, fetchFn);

describe('checkReply', () => {
  it('takes valid ops with their labels', () => {
    const c = checkReply({ ops: [{ op: 'cut', from: 3, to: 3, label: 'Cut 1 filler word' }, { op: 'caption', style: 'bold' }] }, ctx);
    expect(c.problems).toEqual([]);
    expect(c.ops).toEqual([{ op: 'cut', from: 3, to: 3 }, { op: 'caption', style: 'bold' }]);
    expect(c.labels).toEqual(['Cut 1 filler word', '']);
  });

  it('rejects unknown indexes, overlapping cuts, unknown ops and empty results', () => {
    expect(checkReply({ ops: [{ op: 'cut', from: 2, to: 99 }] }, ctx).problems[0]).toMatch(/not a word index/);
    expect(checkReply({ ops: [{ op: 'cut', from: 0, to: 3 }, { op: 'cut', from: 2, to: 4 }] }, ctx).problems[0]).toMatch(/overlaps/);
    expect(checkReply({ ops: [{ op: 'sound', from: 0 }] }, ctx).problems[0]).toMatch(/unknown op/);
    expect(checkReply({ ops: [] }, ctx).problems).toEqual(['The reply has no ops.']);
    expect(checkReply('nope', ctx).problems[0]).toMatch(/"ops" array/);
  });

  it('keeps indexes inside the chunk the model saw', () => {
    expect(checkReply({ ops: [{ op: 'cut', from: 1, to: 1 }] }, { ...ctx, from: 3, to: 6 }).problems).toHaveLength(1);
  });

  it('turns card ops into ai-cant cards unless cards draw, checks the template; never keeps the model\'s words', () => {
    const card = { ops: [{ op: 'card', template: 'title-hook', at: 0, slots: { headline: 'Hello' } }] };
    expect(checkReply(card, ctx).cant).toBe('cards');
    expect(checkReply(card, { ...ctx, cards: true }).ops).toHaveLength(1);
    expect(checkReply({ ops: [{ op: 'card', template: 'big-statement', at: 0, slots: {} }] }, { ...ctx, cards: true }).problems).toEqual(['Op 0: "template" must be title-hook, end-card, logo-sting.']);
    expect(checkReply({ ops: [], cant: 'add sound effects' }, ctx).cant).toBe('other');
  });

  it('treats a missing required slot as a problem, not an empty card', () => {
    const run = (template: string, slots: object) => checkReply({ ops: [{ op: 'card', template, at: 0, slots }] }, { ...ctx, cards: true });
    for (const [t, slot] of [['title-hook', 'headline'], ['end-card', 'cta']] as const) {
      const c = run(t, { kicker: 'New', [slot]: '  ' });
      expect(c.ops).toHaveLength(0);
      expect(c.problems).toEqual([`Op 0: a ${t} card needs "${slot}" text in "slots".`]);
    }
    expect(run('logo-sting', {}).ops).toHaveLength(1);
  });

  it('caps labels, titles and slot text at 80 characters', () => {
    const long = 'x'.repeat(200);
    const c = checkReply({ ops: [
      { op: 'chapter', at: 0, title: long, label: long },
      { op: 'card', template: 't', at: 1, slots: { title: long } },
    ] }, { ...ctx, cards: true, templates: ['t'] });
    expect(c.labels[0]).toHaveLength(MAX_TEXT);
    expect(c.ops[0]).toMatchObject({ title: 'x'.repeat(MAX_TEXT) });
    expect(c.ops[1]).toMatchObject({ slots: { title: 'x'.repeat(MAX_TEXT) } });
  });

  it('keeps a scenes card\'s own text slots within their word limits', () => {
    const c = checkReply({ ops: [{ op: 'card', template: 'title-hook', at: 0, slots: { headline: 'one two three four five six seven eight', kicker: 'New', title: 'gone', x: 3 } }] }, { ...ctx, cards: true });
    expect(c.ops[0]).toEqual({ op: 'card', template: 'title-hook', at: 0, slots: { headline: 'one two three four five six', kicker: 'New' } });
  });

  it('repairs with the first 5 problems, values cut to 40 characters', () => {
    const c = checkReply({ ops: Array.from({ length: 12 }, () => ({ op: 'cut', from: 'y'.repeat(500), to: 1 })) }, ctx);
    const text = repairUser(c.problems);
    expect(text.split('\n').filter((l) => l.startsWith('- Op'))).toHaveLength(MAX_PROBLEMS);
    expect(text).not.toContain('y'.repeat(40));
    expect(tokens(text)).toBeLessThan(400);
  });

  it('reads JSON inside a code fence', () => {
    expect(parseReply('```json\n{"ops":[]}\n```')).toEqual({ ops: [] });
  });
});

describe('askOps', () => {
  it('repairs a bad reply once, through @appskord/llm with an injected fetch', async () => {
    const f = replies({ ops: [{ op: 'cut', from: 3, to: 40 }] }, { ops: [{ op: 'cut', from: 3, to: 3, label: 'Cut “Um,”' }] });
    const c = await askOps({ request: 'Cut the filler', project: base(), units, cards: false, call: callWith(f) });
    expect(c.ops).toEqual([{ op: 'cut', from: 3, to: 3 }]);
    expect(f).toHaveBeenCalledTimes(2);
    const body = JSON.parse((f.mock.calls[1]![1] as RequestInit).body as string) as { messages: ChatMessage[] };
    expect(body.messages.at(-1)!.content).toMatch(/not a word index/);
  });

  it('fails after a second bad reply, and says when it cannot', async () => {
    await expect(askOps({ request: 'x', project: base(), units, cards: false, call: callWith(replies('{', '{')) })).rejects.toEqual(new AiError('failed'));
    const cant = askOps({ request: 'Add a whoosh', project: base(), units, cards: false, call: callWith(replies({ ops: [], cant: 'add sound effects' })) });
    await expect(cant).rejects.toMatchObject({ code: 'cant', detail: 'other' });
  });

  it('sends words by index, never times', async () => {
    const f = replies({ ops: [{ op: 'caption', style: 'clean' }] });
    await askOps({ request: 'Captions', project: base(), units, cards: false, call: callWith(f) });
    const user = (JSON.parse((f.mock.calls[0]![1] as RequestInit).body as string) as { messages: ChatMessage[] }).messages[1]!.content;
    expect(user).toContain('3:Um,');
    expect(user).not.toMatch(/\d:\d\d/);
  });
});

describe('chunking', () => {
  const many: Unit[] = Array.from({ length: 6000 }, (_, i) => ({ start: i * 300, end: i * 300 + 200, text: i % 12 === 11 ? 'done.' : 'word', line: Math.floor(i / 24) }));
  const long = (): Project => ({ ...fromRecording({ ...rec, duration: 1_800_000 }), chapters: [{ at: 0, title: 'Intro' }, { at: 600_000, title: 'Members' }, { at: 1_200_000, title: 'Roles' }] });

  it('groups numbered words by sentence and marks cut words', () => {
    const lines = sentences(base(), units).map((s) => s.line);
    expect(lines).toEqual(['0:Hi, 1:I\'m 2:Sam.', '3:Um, 4:then 5:pick 6:Members.']);
  });

  it('keeps every call under 8,000 tokens and splits at chapters', async () => {
    const f = replies(...Array.from({ length: 20 }, () => ({ ops: [] })), { ops: [{ op: 'caption', style: 'bold' }] });
    const project = long();
    const chunks = chunkTranscript(project, many, 3000);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => tokens(c.text) <= 3100)).toBe(true);
    expect(chunks.slice(1).every((c, i) => c.from === chunks[i]!.to + 1)).toBe(true);
    await askOps({ request: 'Captions', project, units: many, cards: false, call: callWith(f) }).catch(() => undefined);
    for (const [, init] of f.mock.calls) {
      const body = JSON.parse((init as RequestInit).body as string) as { messages: ChatMessage[] };
      expect(tokens(body.messages.map((m) => m.content).join('')) + REPLY_TOKENS).toBeLessThan(MAX_CALL_TOKENS);
    }
  });
});

describe('30-minute transcript', () => {
  // 4,500 words at 150 a minute, with chapters, long words and four-digit indexes.
  const vocab = ['onboarding', 'the', 'dashboard', 'permissions', 'and', 'then', 'invite', 'workspace', 'members', 'settings'];
  const units30: Unit[] = Array.from({ length: 4500 }, (_, i) => ({
    start: i * 400, end: i * 400 + 300, text: i % 15 === 14 ? 'configuration.' : vocab[i % vocab.length]!, line: Math.floor(i / 30),
  }));
  const project30 = (): Project => ({ ...base(), chapters: Array.from({ length: 12 }, (_, k) => ({ at: k * 150_000, title: `Chapter ${k + 1}: ${'setup '.repeat(10)}` })) });

  it('keeps every call, repair included, under 8,000 tokens at two characters a token', async () => {
    // Valid JSON as long as a reply may be, with a long value in each of many bad ops.
    const op = { op: 'cut', from: 'z'.repeat(120), to: 99_999, label: 'q'.repeat(80) };
    const bad = JSON.stringify({ ops: Array.from({ length: Math.floor((REPLY_TOKENS * 2 - 20) / (JSON.stringify(op).length + 1)) }, () => op) });
    const queue: string[] = [];
    const sizes: number[] = [];
    const call: Call = async (messages, { maxTokens }) => {
      sizes.push(tokens(messages.map((m) => m.content).join('')) + maxTokens);
      const last = messages.at(-1)!.content;
      const part = /words (\d+) to/.exec(messages[1]!.content)?.[1] ?? '0';
      // First reply per part is as long as allowed and wrong; the repair is fine.
      if (!last.startsWith('That reply')) return bad;
      queue.push(part);
      return JSON.stringify({ ops: [{ op: 'cut', from: Number(part), to: Number(part) }] });
    };
    const c = await askOps({ request: 'Cut every filler word and tighten the pauses', project: project30(), units: units30, cards: false, call });
    expect(c.ops.length).toBeGreaterThan(1);
    expect(sizes.length).toBe(queue.length * 2);
    expect(Math.max(...sizes)).toBeLessThan(MAX_CALL_TOKENS);
  });
});

describe('drafts', () => {
  const checked = { ops: [{ op: 'cut' as const, from: 3, to: 3 }, { op: 'caption' as const, style: 'bold' as const }], labels: ['Cut 1 filler word', ''] };

  it('lists one row per op with the lengths before and after', () => {
    const d = toDraft(base(), units, 'Tighten it up', checked);
    expect(d.changes.map((c) => c.label)).toEqual(['Cut 1 filler word', 'Changed captions']);
    expect(d.before).toBe(10_000);
    expect(d.after).toBeLessThan(10_000);
  });

  it('shows the words the ticked ops cut, and none once unticked', () => {
    const p = base();
    const d = toDraft(p, units, 'x', checked);
    expect([...draftWords(p, units, d)]).toEqual([3]);
    const off = toggleChange(p, units, d, 0);
    expect(draftWords(p, units, off).size).toBe(0);
    expect(off.after).toBe(10_000);
  });

  it('places the draft on the timeline: cut stretches in output ms and the other changes as marks', () => {
    const p = base();
    const d = toDraft(p, units, 'x', checked);
    expect(draftSpans(p, units, d)).toEqual({ cuts: [{ start: 3000, end: 3600 }], at: [d.changes[1]!.at] });
    expect(draftSpans(p, units, toggleChange(p, units, d, 0)).cuts).toEqual([]);
  });

  it('applies the ticked ops as one Undo step', () => {
    const p = base();
    const applied = applyDraft(p, units, toDraft(p, units, 'x', checked));
    expect(steps(applied).steps.map((s) => s.label)).toEqual(['Applied AI edit · 2 changes']);
    expect(currentCut(applied).captions).toMatchObject({ style: 'bold', show: true });
    expect(cutLength(currentCut(undo(applied)))).toBe(10_000);
    expect(currentCut(undo(applied)).captions.show).toBe(false);
  });
});
