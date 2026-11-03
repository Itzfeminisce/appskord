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
import { createRoot } from 'react-dom/client';
import { MemoryCard } from './AskAll';
import type { MemoryItem } from '@/lib/memory/types';

const ensureModel = vi.fn(async (_p?: (x: { loaded: number; total: number }) => void): Promise<{ ok: true } | { ok: false; reason: string }> => ({ ok: true }));
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

  it('shows the download progress, and a failed download says keyword search still works with Try again', async () => {
    let finish: (r: { ok: false; reason: string }) => void = () => undefined;
    ensureModel.mockImplementationOnce((p) => { p?.({ loaded: 9 * 1024 * 1024, total: 22 * 1024 * 1024 }); return new Promise((r) => { finish = r; }); });
    const view = await mount(sidepanel, 'askall');
    await settle();
    act(() => button(view.host, 'Download (22 MB)').click());
    await settle();
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe('Downloading the search model9 of 22 MBKeyword search works meanwhile.');
    expect(view.host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('9');
    await act(async () => finish({ ok: false, reason: 'denied' }));
    await settle();
    expect((await getSettings()).memory.searchModel).toBe('none');
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('The search model didn’t downloadAccess to huggingface.co was not allowed. Keyword search still works.Try again');
    act(() => button(view.host, 'Try again').click());
    await settle();
    expect(ensureModel).toHaveBeenCalledTimes(2);
    expect((await getSettings()).memory.searchModel).toBe('ready');
  });

  it('a question card says who asked and whether it is still open or answered', () => {
    const meeting = { id: 'm-sync', title: 'Weekly product sync', startedAt: new Date(2026, 10, 2, 10, 0).getTime() };
    const q: MemoryItem = { id: 'q1', kind: 'question', status: 'open', text: 'Who writes the launch email copy?', meetingId: meeting.id, personIds: [], history: [], createdAt: 0, updatedAt: 0,
      quote: { speaker: 'Sam', text: 'Who’s writing the launch email copy?', meetingId: meeting.id, atMs: 535_000 } };
    const card = (item: MemoryItem) => {
      const host = document.createElement('div');
      const root = createRoot(host);
      act(() => root.render(<MemoryCard s={{ n: 1, kind: 'item', meetingId: meeting.id, title: meeting.title, startedAt: meeting.startedAt, atMs: item.quote.atMs, item }} onOpen={() => undefined} meetings={[meeting]} />));
      return host.textContent;
    };
    expect(card(q)).toBe('Open question · asked by SamStill openWho writes the launch email copy?Sam: “Who’s writing the launch email copy?”Weekly product sync · 2 Nov · 08:55');
    const answer = { speaker: 'Priya', text: 'I’ll write it, you’ll have it by Thursday.', meetingId: meeting.id, atMs: 570_000 };
    expect(card({ ...q, status: 'answered', history: [answer] })).toBe('Question · asked by SamAnswered 2 NovWho writes the launch email copy?Sam: “Who’s writing the launch email copy?”Weekly product sync · 2 Nov · 08:55Priya: “I’ll write it, you’ll have it by Thursday.”Weekly product sync · 2 Nov · 09:30');
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
