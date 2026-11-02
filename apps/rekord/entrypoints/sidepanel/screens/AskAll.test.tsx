// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askMemorySession } from '@/lib/askAll';
import { closeDB, getDB } from '@/lib/db';
import { SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { getSettings, updateSettings } from '@/lib/settings';
import { mount, settle } from '../../../test/mountRouter';
import { sidepanel } from '../App';
import { world } from '../components/v4/world';
import { DEV_FRAMES } from '../dev/frames';

const ensureModel = vi.fn(async (_p?: (x: { loaded: number; total: number }) => void) => true);
vi.mock('@/lib/recall', async (orig) => ({ ...(await orig<typeof import('@/lib/recall')>()), ensureModel: (p?: never) => ensureModel(p), embedPending: async () => 0 }));

const button = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;

describe('Ask all by meaning', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB());
    await updateSettings({ onboarded: true, memory: { ...(await getSettings()).memory, searchModel: 'none' } });
    world.now = () => SAMPLE_NOW;
    askMemorySession.turns = [];
    askMemorySession.scope = 'all';
    ensureModel.mockClear();
  });

  it('first use asks for the model above the cited answer and its cards', async () => {
    await DEV_FRAMES.V4AskAll!.setup!();
    const view = await mount(sidepanel, 'askall');
    await settle();
    const text = view.host.textContent!;
    expect(text).toContain('Search by meaning?');
    expect(text).toContain('Download (22 MB)');
    expect(text).toContain('The Team plan is $12 a seat, up from $10, agreed at the Pricing review on 26 Oct.[1] You still owe Sarah the revised pricing deck, 4 days late.[2]');
    expect(text).toContain('Replaces: Team plan is $10 a seat (3 Oct)');
    expect(text).toContain('Overdue 4 days');
    expect([...view.host.querySelectorAll('[aria-pressed]')].map((b) => b.textContent)).toEqual(['All meetings', 'People', 'Decisions']);
    act(() => button(view.host, 'Source 2').click());
    await settle();
    expect(view.router.route).toMatchObject({ screen: 'transcript', params: { meetingId: 'm-pricing-review' } });
  });

  it('Download keeps the model for next time and hides the card', async () => {
    const view = await mount(sidepanel, 'askall');
    await settle();
    act(() => button(view.host, 'Download (22 MB)').click());
    await settle();
    expect(ensureModel).toHaveBeenCalled();
    expect((await getSettings()).memory.searchModel).toBe('ready');
    expect(view.host.textContent).not.toContain('Search by meaning?');
  });

  it('a failed download leaves the choice open', async () => {
    ensureModel.mockResolvedValueOnce(false);
    const view = await mount(sidepanel, 'askall');
    await settle();
    act(() => button(view.host, 'Download (22 MB)').click());
    await settle();
    expect((await getSettings()).memory.searchModel).toBe('none');
    expect(view.host.textContent).toContain('Search by meaning?');
  });

  it('Keep keyword search brings back the v3 screen and remembers it', async () => {
    const view = await mount(sidepanel, 'askall');
    await settle();
    act(() => button(view.host, 'Keep keyword search').click());
    await settle();
    expect(ensureModel).not.toHaveBeenCalled();
    expect((await getSettings()).memory.searchModel).toBe('asked');
    expect(view.host.textContent).toContain('Last 30 days');
    expect(view.host.textContent).not.toContain('Search by meaning?');
    const again = await mount(sidepanel, 'askall');
    await settle();
    expect(again.host.textContent).toContain('Last 7 days');
  });
});
