import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDB } from '../db';
import { saveKeys } from '../penv';
import { cleanDraft, draftNudge, NUDGE_LEDGER_WHAT, nudgeMessages, type NudgeInput } from './nudge';
import { SAMPLE_ITEMS } from './sample';
import { listLedger } from './store';

const q3 = SAMPLE_ITEMS.find((i) => i.id === 'i-q3')!;
const input: NudgeInput = { item: q3, toName: 'Sarah', me: 'Alex', madeIn: '1:1 with Sarah · 27 Oct', due: 'due today', nextMeeting: 'today at 10:00', tone: 'friendly' };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

beforeEach(async () => {
  fakeBrowser.reset();
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  await saveKeys({ GROQ_API_KEY: 'gsk_test' });
});

describe('nudge draft', () => {
  it('sends the promise, its quote and the tone, and nothing else', () => {
    const user = nudgeMessages({ ...input, tone: 'firm' })[1]!.content as string;
    expect(user).toContain('What they promised: Q3 usage numbers');
    expect(user).toContain('Sarah: “I’ll get you the Q3 usage numbers by next Tuesday.” (1:1 with Sarah · 27 Oct)');
    expect(user).toContain('Our next meeting: today at 10:00');
    expect(user).toContain('Sign off as: Alex');
    expect(user).toMatch(/Tone: Polite but direct/);
  });

  it('cleans a subject line and wrapping quotes off the reply', () => {
    expect(cleanDraft('Subject: Q3\n"Hi Sarah,\nCould you send them?\nThanks, Alex"')).toBe('Hi Sarah, Could you send them? Thanks, Alex');
  });

  it('asks the AI once and records one ledger entry for the call', async () => {
    const fetchFn = vi.fn(async () => reply('Hi Sarah, could you send the Q3 usage numbers today? Thank you, Alex'));
    expect(await draftNudge(input, { fetchFn })).toBe('Hi Sarah, could you send the Q3 usage numbers today? Thank you, Alex');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const ledger = await listLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ service: 'groq', what: NUDGE_LEDGER_WHAT, meetingId: q3.meetingId, count: 1 });
  });

  it('records nothing when there is no key, since nothing left the browser', async () => {
    await saveKeys({});
    await expect(draftNudge(input, { fetchFn: vi.fn() })).rejects.toThrow();
    expect(await listLedger()).toHaveLength(0);
  });
});
