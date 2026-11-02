// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import { mount, settle } from '../../../../test/mountRouter';
import { initialRoute, sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';
import { frameInHash } from '../../dev/open';
import { BACKFILL_ALARM, BACKFILL_KEY, type BackfillMeeting } from '@/lib/memory/backfill';
import { backfillView, moreLine } from './backfillView';
import { backfillMinutes } from './WhatsNew';

const rows = (done: number, waiting: number): BackfillMeeting[] => [
  ...Array.from({ length: done }, (_, i) => ({ id: `d${i}`, title: `Done ${i}`, status: 'done' as const, found: 1 })),
  { id: 'w', title: 'Working', status: 'working' as const },
  ...Array.from({ length: waiting }, (_, i) => ({ id: `q${i}`, title: `Waiting ${i}`, status: 'waiting' as const })),
];

describe('backfill rows', () => {
  it('shows three finished meetings, the current one and the next, and counts the rest', () => {
    const view = backfillView(rows(9, 13));
    expect(view.rows.map((r) => r.id)).toEqual(['d6', 'd7', 'd8', 'w', 'q0']);
    expect(moreLine(view.more)).toBe('and 18 more: 6 done, 12 waiting');
  });

  it('keeps five rows at the start and the end', () => {
    expect(backfillView(rows(0, 6)).rows.map((r) => r.id)).toEqual(['w', 'q0', 'q1', 'q2', 'q3']);
    expect(backfillView(rows(6, 0)).rows.map((r) => r.id)).toEqual(['d2', 'd3', 'd4', 'd5', 'w']);
    expect(moreLine(backfillView(rows(0, 6)).more)).toBe('and 2 more: 2 waiting');
  });

  it('estimates about 15 seconds a meeting', () => {
    expect(backfillMinutes(23)).toBe(6);
    expect(backfillMinutes(1)).toBe(1);
  });
});

describe('v4 screens', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB());
    await updateSettings({ onboarded: true, memory: { ...(await getSettings()).memory, backfill: 'ask' } });
    world.now = () => SAMPLE_NOW;
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '4.0.0' } as ReturnType<typeof browser.runtime.getManifest>);
  });

  it('opens on Open loops once onboarded', async () => {
    expect(await initialRoute()).toEqual({ screen: 'home', params: {} });
  });

  it('what’s new offers to build memory from earlier meetings and starts it', async () => {
    const view = await mount(sidepanel, 'whatsnew');
    await settle();
    expect(view.host.querySelector('h2')?.textContent).toBe('Build memory from your 24 earlier meetings');
    act(() => view.host.querySelector<HTMLButtonElement>('.wn-build')!.click());
    await settle();
    expect(view.router.route.screen).toBe('backfill');
    // Starting writes settings after the route change; under a loaded CI runner one settle is not enough.
    await vi.waitFor(async () => expect((await getSettings()).memory.backfill).toBe('running'));
    await vi.waitFor(async () => expect(await browser.alarms.get(BACKFILL_ALARM)).toBeDefined());
    expect(((await browser.storage.local.get(BACKFILL_KEY))[BACKFILL_KEY] as { total: number }).total).toBe(20);
  });

  it('Not now is asked once', async () => {
    const view = await mount(sidepanel, 'whatsnew');
    await settle();
    act(() => view.host.querySelector<HTMLButtonElement>('.wn-later')!.click());
    await settle();
    expect(view.router.route.screen).toBe('home');
    expect((await getSettings()).memory.backfill).toBe('declined');
    const again = await mount(sidepanel, 'whatsnew');
    await settle();
    expect(again.host.querySelector('.wn-card')).toBeNull();
  });

  it('backfill shows live progress and the limit pause', async () => {
    await DEV_FRAMES.V4Backfill!.setup!();
    const view = await mount(sidepanel, 'backfill');
    await settle();
    const text = view.host.textContent!;
    expect(text).toContain('9 of 23 meetings');
    expect(text).toContain('So far: 14 promises, 6 decisions, 5 people');
    expect(text).toContain('Groq’s free limit is used up for now. Rekord carries on at 14:05 by itself.');
    expect(text).toContain('and 18 more: 6 done, 12 waiting');
    expect(view.host.querySelectorAll('.bf-row')).toHaveLength(5);
    expect(view.host.querySelector('.bf-toast')).toBeNull();
    const finished = (await browser.storage.local.get(BACKFILL_KEY))[BACKFILL_KEY] as { total: number };
    await browser.storage.local.set({ [BACKFILL_KEY]: { ...finished, done: finished.total, resumeAt: undefined, totals: { promises: 41, decisions: 18, people: 12 } } });
    const done = await mount(sidepanel, 'backfill');
    await settle();
    expect(done.host.querySelector('.bf-toast')?.textContent).toBe('Memory is ready: 41 promises, 18 decisions, 12 people');
  });
});

describe('backfill failures', () => {
  it('counts a failed meeting as finished and shows the connection problem', async () => {
    await DEV_FRAMES.V4Backfill!.setup!();
    const stored = (await browser.storage.local.get(BACKFILL_KEY))[BACKFILL_KEY] as { meetings: BackfillMeeting[] };
    stored.meetings.find((m) => m.status === 'working')!.status = 'failed';
    await browser.storage.local.set({ [BACKFILL_KEY]: { ...stored, error: 'key', failed: 1 } });
    const view = await mount(sidepanel, 'backfill');
    await settle();
    expect(view.host.querySelector('.bf-failed')).not.toBeNull();
    expect(view.host.querySelector('[aria-label="AI connection"]')?.textContent).toContain('Groq didn’t accept your key.');
    await browser.storage.local.set({ [BACKFILL_KEY]: { ...stored, error: 'model' } });
    const model = await mount(sidepanel, 'backfill');
    await settle();
    expect(model.host.querySelector('[aria-label="AI connection"]')?.textContent).toContain('Groq isn’t responding.');
  });

  it('a finished and a failed meeting both leave the current row behind', () => {
    const list: BackfillMeeting[] = [{ id: 'a', title: 'A', status: 'failed' }, { id: 'b', title: 'B', status: 'waiting' }];
    expect(backfillView(list).rows).toHaveLength(2);
    expect(backfillView(list).more.count).toBe(0);
  });
});

describe('dev frame routes', () => {
  it('names a registered screen for every frame and reads the frame from the hash', () => {
    for (const frame of Object.values(DEV_FRAMES)) expect(sidepanel.names).toContain(frame.screen);
    expect(frameInHash('#/dev/V4Backfill')).toBe('V4Backfill');
    expect(frameInHash('#/home')).toBeUndefined();
  });
});
