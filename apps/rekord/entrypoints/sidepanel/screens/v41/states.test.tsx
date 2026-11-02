// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatchupStatus } from '@/lib/catchup/pipeline';
import { closeDB, getDB } from '@/lib/db';
import { seedSample, seedSampleV41, V41_CATCHUP } from '@/lib/memory/sample';
import { mount, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';
import { STATE_CARDS } from '../../dev/frames41states';
import { nothingFound } from './tell';

const steps = (done: boolean, extra: Partial<CatchupStatus['steps'][number]> = {}): CatchupStatus['steps'] =>
  (['text', 'questions', 'decisions', 'promises', 'summary'] as const).map((step) => ({ step, done, ...extra }));
const status = (found: number, s = steps(true)): CatchupStatus => ({ steps: s, decisions: 0, promises: 0, found, questions: [] });

describe('nothing found', () => {
  it('only once memory finished without failing and kept nothing', () => {
    expect(nothingFound(status(0))).toBe(true);
    expect(nothingFound(status(1))).toBe(false);
    expect(nothingFound(status(0, steps(false)))).toBe(false);
    expect(nothingFound(status(0, steps(false, { failed: 'limit', resumesAt: 1 })))).toBe(false);
  });
});

/** Every V41States and V41StatesMore card, with the copy its frame shows. */
const COPY: Record<string, string[]> = {
  MicBlocked: ['Rekord can’t use your microphone', 'Allow it for Rekord, or type what happened instead.', 'Allow microphone', 'Type instead'],
  NoAi: ['Connect an AI to catch up', 'Rekord needs it to turn what you tell it into notes. What you say goes only to the AI you connect.', 'Connect Penv Cloud', 'Paste a key'],
  Paused: ['Paused · 06:15', 'Resume', 'The microphone is off while paused. Prompts stay as they are.'],
  NothingHeard: ['Rekord hasn’t heard anything yet', 'Check your microphone is on and not muted, then keep talking.', 'No sound'],
  NearLimit: ['Catching up · 55:00 · 5 min left', '5 minutes left', 'A catch-up can run 60 minutes. Wrap up now, or add more later from the meeting page.'],
  AtLimit: ['You reached 60 minutes', 'Rekord stopped and kept everything you said. You can add more from the meeting page.', 'Continue'],
  Leave: ['Stop catching up?', 'What you said so far is kept. You can add more later.', 'Keep talking', 'Stop and save', 'Discard'],
  TooSoon: ['Say a little more', 'Rekord needs a few sentences to work with. Who was there is a good start.', 'Keep talking', 'Discard'],
  Offline: ['You’re offline', 'Keep talking. Your audio is saved on this computer and turned into text when you’re back.'],
  TextFailed: ['Couldn’t turn your telling into text', 'Your audio is saved on this computer. Nothing was lost.', 'Try again', 'Type it instead'],
  NoQuestions: ['No questions. You covered it all.', 'Finish'],
  NothingFound: ['Nothing to remember yet', 'Your catch-up is saved, but Rekord found no promises, decisions or questions in it.', 'Add more', 'Keep as a note'],
  Dismissed: ['Won’t ask about “Q4 planning with Northwind” again', 'Undo'],
  Adding: ['Adding more · 00:24', 'Goes on the end of your telling. Prompts show what is already covered.'],
  DeleteConfirm: ['Delete this catch-up?', 'Your telling and its 4 memory items are deleted from this computer.', 'Delete', 'Cancel'],
  Deleted: ['“Q4 planning with Northwind” catch-up was deleted', 'Its 4 memory items and your telling are gone too.', 'Undo'],
  AudioDeleted: ['Audio of your telling deleted. The notes stay.', 'Undo'],
  NoMissed: ['No missed meetings in the last 7 days', 'Rekord recorded every calendar meeting. Pick “Something else” for any other.'],
  NoCalendar: ['Connect Google Calendar to pick from your meetings', 'Or pick “Something else” and fill in the details.', 'Connect Google Calendar'],
  ProcessingFailed: ['Couldn’t put your catch-up together', 'Your telling and your answers are saved on this computer. Nothing was lost.', 'Try again', 'Read your telling'],
  AiLimit: ['Paused for now', 'Groq’s free limit is used up for now. Rekord carries on at 17:45 by itself.', 'You can close the panel. Rekord finishes in the background.'],
  Voice: ['Listening', 'No, she was there to listen.', 'Click the mic again to stop.', 'Skip'],
  Reopened: ['Your answer was “By Friday.”', 'Cancel'],
  NoName: ['Give the meeting a name, so you can find it later.'],
  FutureDate: ['That date hasn’t happened yet. Pick the day the meeting took place.'],
};

/** The background's answer to "catchup/progress". */
const progress = (st: CatchupStatus) => vi.spyOn(browser.runtime, 'sendMessage').mockImplementation((async (msg: { type: string }) => (msg.type === 'catchup/progress' ? st : undefined)) as never);

const PARAM: Record<string, string> = { eventId: 'event', meetingId: 'meeting' };

describe('state cards', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB(), 'before');
    vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('every card has a route and its copy', () => {
    expect(Object.keys(STATE_CARDS).sort()).toEqual(Object.keys(COPY).sort());
  });

  for (const [card, copy] of Object.entries(COPY)) {
    it(`#/dev/V41States${card} shows its card on the real screen`, async () => {
      const f = DEV_FRAMES[`V41States${card}`]!;
      world.now = () => f.now!;
      await f.setup!();
      const search = new URLSearchParams(Object.entries(f.params ?? {}).map(([k, v]) => [PARAM[k] ?? k, String(v)]));
      const view = await mount(sidepanel, f.screen, `/${f.screen}?${search}`);
      const text = () => view.host.textContent?.replace(/\s+/g, ' ') ?? '';
      await waitFor(() => copy.every((c) => text().includes(c)) || undefined);
      if (card === 'NoName') expect(view.host.querySelector('#f-name')?.getAttribute('aria-invalid')).toBe('true');
      if (card === 'FutureDate') expect((view.host.querySelector('#f-date') as HTMLInputElement).value).toBe('2026-11-05');
    });
  }

  it('nothing found stays on Processing; Keep as a note opens the meeting page', async () => {
    await seedSampleV41(await getDB(), 'after');
    progress(status(0));
    const view = await mount(sidepanel, 'catchupProcessing', `/catchupProcessing?meeting=${V41_CATCHUP.id}`);
    const keep = await waitFor(() => [...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Keep as a note') || false);
    expect(view.router.route.screen).toBe('catchupProcessing');
    act(() => keep!.click());
    await waitFor(() => view.router.route.screen === 'summary' || undefined);
  });

  it('with something found, Processing opens the meeting page by itself', async () => {
    await seedSampleV41(await getDB(), 'after');
    progress(status(3));
    const view = await mount(sidepanel, 'catchupProcessing', `/catchupProcessing?meeting=${V41_CATCHUP.id}`);
    await waitFor(() => view.router.route.screen === 'summary' || undefined);
    expect(view.host.textContent).not.toContain('Nothing to remember yet');
  });
});
