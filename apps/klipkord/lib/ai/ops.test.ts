import { describe, expect, it, vi } from 'vitest';
import { chat, PROVIDERS, type ChatMessage, type FetchLike } from '../llm';
import { currentCut, steps, undo } from '../project/history';
import { fromRecording } from '../project/migrate';
import { cutLength } from '../project/time';
import type { Project } from '../project/types';
import type { Recording } from '../types';
import type { Unit } from '../wordCuts';
import { AiError, applyDraft, askOps, checkReply, draftWords, parseReply, toDraft, toggleChange, type Call } from './ops';
import { chunkTranscript, MAX_CALL_TOKENS, REPLY_TOKENS, sentences, tokens } from './prompt';

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

  it('turns card ops into ai-cant while cards are not ready, and passes the model\'s own cant on', () => {
    expect(checkReply({ ops: [{ op: 'card', template: 'title-hook', at: 0, slots: {} }] }, ctx).cant).toBe('add cards yet');
    expect(checkReply({ ops: [], cant: 'add sound effects' }, ctx).cant).toBe('add sound effects');
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
    await expect(cant).rejects.toMatchObject({ code: 'cant', detail: 'add sound effects' });
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

  it('applies the ticked ops as one Undo step', () => {
    const p = base();
    const applied = applyDraft(p, units, toDraft(p, units, 'x', checked));
    expect(steps(applied).steps.map((s) => s.label)).toEqual(['Applied AI edit · 2 changes']);
    expect(currentCut(applied).captions).toMatchObject({ style: 'bold', show: true });
    expect(cutLength(currentCut(undo(applied)))).toBe(10_000);
    expect(currentCut(undo(applied)).captions.show).toBe(false);
  });
});
