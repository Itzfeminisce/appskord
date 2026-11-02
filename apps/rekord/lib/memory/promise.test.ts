import { describe, expect, it } from 'vitest';
import { canApply, transition } from './promise';
import type { MemoryItem, Quote } from './types';

const q: Quote = { speaker: 'Alex', text: 'I shared it.', meetingId: 'm', atMs: 1 };
const base = (patch: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'i', kind: 'promise', status: 'open', text: 'Send the deck', quote: q, meetingId: 'm', ownerId: 'me', toId: 'p',
  personIds: ['p'], history: [], createdAt: 0, updatedAt: 0, ...patch,
});

describe('promise state machine', () => {
  it('confirms a suggestion and stamps the time', () => {
    const next = transition(base({ status: 'suggested', leftOut: true }), { type: 'confirm' }, 50);
    expect(next).toMatchObject({ status: 'open', updatedAt: 50 });
    expect(next.leftOut).toBeUndefined();
  });

  it('marks done and undoes back to open', () => {
    const done = transition(base({ snoozedUntil: 9 }), { type: 'done' }, 1);
    expect(done.status).toBe('done');
    expect(done.snoozedUntil).toBeUndefined();
    expect(transition(done, { type: 'undo' }, 2).status).toBe('open');
  });

  it('edits text and due date without changing status', () => {
    const next = transition(base(), { type: 'edit', changes: { text: 'Send v2', due: '2026-11-03' } }, 1);
    expect(next).toMatchObject({ status: 'open', text: 'Send v2', due: '2026-11-03' });
  });

  it('snoozes an open promise', () => {
    expect(transition(base(), { type: 'snooze', until: 99 }, 1).snoozedUntil).toBe(99);
  });

  it('drops with a reason and dismisses a suggestion, both undoable', () => {
    const dropped = transition(base(), { type: 'drop', reason: 'someoneElse' }, 1);
    expect(dropped).toMatchObject({ status: 'dropped', dropReason: 'someoneElse' });
    expect(transition(dropped, { type: 'undo' }, 2)).toMatchObject({ status: 'open', dropReason: undefined });
    const dismissed = transition(base({ status: 'suggested' }), { type: 'drop', reason: 'notAPromise' }, 1);
    expect(dismissed).toMatchObject({ status: 'dismissed', dismissReason: 'notAPromise' });
    expect(transition(dismissed, { type: 'undo' }, 2).status).toBe('suggested');
  });

  it('moves to looks done with evidence, and back on not yet', () => {
    const looks = transition(base(), { type: 'looksDone', evidence: q }, 1);
    expect(looks).toMatchObject({ status: 'looksDone', evidence: q });
    expect(transition(looks, { type: 'done' }, 2).status).toBe('done');
    const notYet = transition(looks, { type: 'notYet' }, 2);
    expect(notYet.status).toBe('open');
    expect(notYet.evidence).toBeUndefined();
  });

  it('answers a question and keeps the answer quote', () => {
    const next = transition(base({ kind: 'question' }), { type: 'answer', quote: q }, 1);
    expect(next).toMatchObject({ status: 'answered', history: [q] });
  });

  it('replaces a decision and undoes the replace', () => {
    const replaced = transition(base({ kind: 'decision' }), { type: 'replace', byId: 'd2' }, 1);
    expect(replaced).toMatchObject({ status: 'replaced', replacedById: 'd2' });
    const back = transition(replaced, { type: 'undoReplace' }, 2);
    expect(back.status).toBe('open');
    expect(back.replacedById).toBeUndefined();
  });

  it('ignores events that do not apply', () => {
    const decision = base({ kind: 'decision' });
    expect(canApply(decision, { type: 'done' })).toBe(false);
    expect(transition(decision, { type: 'done' }, 1)).toBe(decision);
    expect(canApply(base(), { type: 'answer' })).toBe(false);
    expect(canApply(base({ status: 'done' }), { type: 'edit', changes: {} })).toBe(false);
    expect(canApply(base(), { type: 'drop', reason: 'wrongPerson' })).toBe(false);
    expect(canApply(base({ status: 'open' }), { type: 'notYet' })).toBe(false);
  });
});
