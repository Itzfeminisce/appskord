// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { getAgenda, listItems, listPeople } from '@/lib/memory/store';
import { SAMPLE_AFTER, SAMPLE_AGENDA, SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { mount, settle, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Seeds the frame's world and runs its setup, as `#/dev/<Frame>` does. */
async function frame(name: string) {
  const f = DEV_FRAMES[name]!;
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  await seedSample(await getDB(), f.moment ?? 'before');
  world.now = () => f.now ?? (f.moment === 'after' ? SAMPLE_AFTER : SAMPLE_NOW);
  await f.setup?.();
  return f;
}

beforeEach(() => {
  vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue(undefined);
});

describe('V4ForgetAll', () => {
  it('forgets nothing until "forget" is typed; Keep closes the sheet', async () => {
    await frame('V4ForgetAll');
    const view = await mount(sidepanel, 'settingsMemory', '/settingsMemory');
    const sheet = await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false);
    expect(sheet.querySelector('h1')?.textContent).toBe('Forget all memory?');
    expect(sheet.textContent).toContain('74 items');
    expect(sheet.textContent).toContain('12 people');
    expect(sheet.textContent).toContain('The memory files in the Rekord folder');
    expect(sheet.textContent).toContain('Your 24 meetings, transcripts, audio and summaries');
    const forget = button(sheet, 'Forget all memory')!;
    expect(forget.disabled).toBe(true);
    await type(sheet.querySelector('#fa-confirm') as HTMLInputElement, 'forge');
    expect(forget.disabled).toBe(true);
    click(button(sheet, 'Keep'));
    expect(view.host.querySelector('[role="dialog"]')).toBeNull();
    expect((await listItems()).length).toBe(74);
  });

  it('forgets memory once confirmed, and keeps the meetings', async () => {
    await frame('V4ForgetAll');
    const view = await mount(sidepanel, 'settingsMemory', '/settingsMemory');
    const sheet = await waitFor(() => view.host.querySelector('[role="dialog"]') ?? false);
    await type(sheet.querySelector('#fa-confirm') as HTMLInputElement, 'Forget');
    click(button(sheet, 'Forget all memory'));
    await waitFor(async () => expect((await listItems()).length).toBe(0));
    expect(await listPeople()).toEqual([]);
    expect((await (await getDB()).getAll('meetings')).length).toBe(24);
    await waitFor(() => expect(view.host.querySelector('[role="dialog"]')).toBeNull());
  });

  it('"Forget all" in Settings opens the sheet instead of forgetting at once', async () => {
    await frame('V4SettingsMemory');
    const view = await mount(sidepanel, 'settingsMemory', '/settingsMemory');
    click(await waitFor(() => button(view.host, 'Forget all') ?? false));
    await waitFor(() => expect(view.host.querySelector('#fa-title')?.textContent).toBe('Forget all memory?'));
    expect((await listItems()).length).toBe(74);
  });
});

describe('V4LedgerAll', () => {
  it('totals each service for this week, and the chips change the period', async () => {
    await frame('V4LedgerAll');
    const view = await mount(sidepanel, 'ledger', '/ledger');
    await waitFor(() => expect(view.host.querySelectorAll('.lg-item').length).toBe(6));
    expect(view.host.querySelector('.lg-title span')?.textContent).toBe('Settings · 26 Oct to 3 Nov');
    expect([...view.host.querySelectorAll('.lg-item')].map((li) => li.textContent)).toEqual([
      'GroqAudio and text from 9 meetings · 214 requests', 'Google CalendarRead 11 events', 'Google Tasks5 tasks sent',
      'Notion2 pages', 'huggingface.coSearch model, once · 29 Oct', 'LinearNothing yet',
    ]);
    expect(button(view.host, 'This week')?.getAttribute('aria-pressed')).toBe('true');
    click(button(view.host, 'All time'));
    await waitFor(() => expect(button(view.host, 'All time')?.getAttribute('aria-pressed')).toBe('true'));
  });
});

describe('V4Live and V4LiveAgenda', () => {
  it('"What did I miss?" sits at the end of the agenda strip, not in Ask', async () => {
    await frame('V4Live');
    const view = await mount(sidepanel, 'live', `/live?meeting=${'m-sarah-11-03'}`);
    const strip = await waitFor(() => view.host.querySelector('.lv-strip') ?? false);
    expect(strip.lastElementChild?.textContent).toBe('What did I miss?');
    click(button(view.host, 'Ask'));
    await settle();
    expect(view.host.querySelector('.lv-ask')?.textContent ?? '').not.toContain('What did I miss?');
  });

  it('a skipped item is muted with "Skipped", and "Bring back" opens it again', async () => {
    await frame('V4LiveAgenda');
    const view = await mount(sidepanel, 'live', `/live?meeting=${'m-sarah-11-03'}`);
    const row = await waitFor(() => view.host.querySelector('.lv-ag-row.skipped') ?? false);
    expect(row.textContent).toBe('Seat count for the rolloutSkippedBring back');
    click(row.querySelector('[aria-label="Bring back Seat count for the rollout"]'));
    await waitFor(async () => expect((await getAgenda(SAMPLE_AGENDA.meetingKey))?.items.some((i) => i.skipped)).toBe(false));
    await waitFor(() => expect(view.host.querySelector('.lv-ag-row.skipped')).toBeNull());
  });
});
