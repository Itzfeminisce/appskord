// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DISMISSED_KEY } from '@/lib/catchup/types';
import { closeDB, getDB } from '@/lib/db';
import { seedSample, V41_FORM, V41_NOW } from '@/lib/memory/sample';
import { updateSettings } from '@/lib/settings';
import { mount, settle, waitFor } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { world } from '../../components/v4/world';
import { DEV_FRAMES } from '../../dev/frames';
import { checkOther, DATE_ERROR, NAME_ERROR, otherParams } from './PickOther';

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === text)!;
const type = (input: HTMLInputElement, value: string) => act(() => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('start screens', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB(), 'before');
    world.now = () => V41_NOW;
    await browser.storage.local.remove(DISMISSED_KEY);
  });

  it('Home shows the latest missed meeting; Catch up goes to telling for it', async () => {
    await DEV_FRAMES.V41Home!.setup!();
    const view = await mount(sidepanel, 'home', '/home');
    const card = await waitFor(() => view.host.querySelector('[aria-label="Missed meeting"]') ?? false);
    expect(card.textContent).toContain('Missed “Q4 planning with Northwind”?');
    expect(card.textContent).toContain('Today 13:00 to 17:00. Rekord didn’t record it.');
    expect(card.textContent).not.toContain('more missed');
    click(button(card, 'Catch up'));
    await settle();
    expect(view.router.route).toEqual({ screen: 'catchupTell', params: { eventId: 'evt-northwind-1102' } });
  });

  it('two missed: one card plus "1 more missed meeting" to the picker', async () => {
    await DEV_FRAMES.V41HomeTwoMissed!.setup!();
    const view = await mount(sidepanel, 'home', '/home');
    const card = await waitFor(() => view.host.querySelector('[aria-label="Missed meeting"]') ?? false);
    expect(view.host.querySelectorAll('[aria-label="Missed meeting"]')).toHaveLength(1);
    expect(card.textContent).toContain('Q4 planning with Northwind');
    click(button(card, '1 more missed meeting'));
    await settle();
    expect(view.router.route.screen).toBe('catchupPick');
  });

  it('dismiss stores the event id, hides the card and shows the toast; Undo brings it back', async () => {
    await DEV_FRAMES.V41Home!.setup!();
    const view = await mount(sidepanel, 'home', '/home');
    await waitFor(() => view.host.querySelector('[aria-label="Missed meeting"]') ?? false);
    click(view.host.querySelector('[aria-label="Dismiss. Don’t ask about this meeting again"]'));
    await waitFor(() => !view.host.querySelector('[aria-label="Missed meeting"]'));
    expect((await browser.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY]).toEqual(['evt-northwind-1102']);
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain('Won’t ask about “Q4 planning with Northwind” again');
    click(button(view.host.querySelector('[role="status"]')!, 'Undo'));
    await waitFor(() => view.host.querySelector('[aria-label="Missed meeting"]') ?? false);
    expect((await browser.storage.local.get(DISMISSED_KEY))[DISMISSED_KEY]).toEqual([]);
  });

  it('the setting turns the card off', async () => {
    await DEV_FRAMES.V41Home!.setup!();
    await updateSettings({ missedMeetingCard: false });
    const view = await mount(sidepanel, 'home', '/home');
    await settle();
    expect(view.host.querySelector('[aria-label="Missed meeting"]')).toBeNull();
    expect(view.host.textContent).toContain('Missed a meeting?');
  });

  it('the quiet line on Home goes to the picker', async () => {
    const view = await mount(sidepanel, 'home', '/home');
    click(button(view.host, 'Missed a meeting? Catch up'));
    await settle();
    expect(view.router.route.screen).toBe('catchupPick');
  });

  it('Pick lists the last 7 days without recorded meetings, picks one and starts telling', async () => {
    await DEV_FRAMES.V41Pick!.setup!();
    const view = await mount(sidepanel, 'catchupPick', '/catchupPick');
    await waitFor(() => view.host.querySelectorAll('input[type="radio"]').length === 3);
    const rows = [...view.host.querySelectorAll('label.cu-opt')].map((l) => l.textContent);
    expect(rows).toEqual([
      'Q4 planning with NorthwindToday · 13:00 · 4 hSarah, Tom, Priya',
      'Hiring syncThu 29 Oct · 15:00 · 30 minPriya, Sam',
      'Team retroWed 28 Oct · 16:00 · 45 minPriya, Sam',
    ]);
    expect((view.host.querySelector('#m-evt-northwind-1102') as HTMLInputElement).checked).toBe(true);
    click(view.host.querySelector('#m-evt-hiring-1029'));
    click(button(view.host, 'Start telling'));
    await settle();
    expect(view.router.route).toEqual({ screen: 'catchupTell', params: { eventId: 'evt-hiring-1029' } });
  });

  it('PickOther: no name or a future date shows the message and stays', async () => {
    const view = await mount(sidepanel, 'catchupPickOther', '/catchupPickOther');
    click(button(view.host, 'Start telling'));
    expect(view.host.querySelector('#f-name-msg')?.textContent).toBe(NAME_ERROR);
    expect(view.host.querySelector('#f-name')?.getAttribute('aria-invalid')).toBe('true');
    type(view.host.querySelector('#f-name') as HTMLInputElement, 'Lunch with Dana');
    type(view.host.querySelector('#f-date') as HTMLInputElement, '2026-11-05');
    click(button(view.host, 'Start telling'));
    expect(view.host.querySelector('#f-date-msg')?.textContent).toBe(DATE_ERROR);
    expect(view.router.route.screen).toBe('catchupPickOther');
  });

  it('PickOther: a valid form goes to telling with what was entered', async () => {
    const view = await mount(sidepanel, 'catchupPickOther', '/catchupPickOther');
    type(view.host.querySelector('#f-name') as HTMLInputElement, 'Lunch with Dana');
    type(view.host.querySelector('#f-date') as HTMLInputElement, '2026-10-30');
    type(view.host.querySelector('#f-time') as HTMLInputElement, '12:30');
    type(view.host.querySelector('#f-who') as HTMLInputElement, 'Dana Ruiz');
    await act(async () => { view.host.querySelector('#f-who')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    expect(view.host.querySelector('[aria-label="Remove Dana Ruiz"]')).not.toBeNull();
    click(button(view.host, 'Start telling'));
    await settle();
    expect(view.router.route).toEqual({ screen: 'catchupTell', params: { title: 'Lunch with Dana', date: '2026-10-30', time: '12:30', lengthMin: 60, who: 'Dana Ruiz' } });
  });
});

describe('form rules', () => {
  it('checkOther: a name and a day that has happened', () => {
    expect(checkOther({ name: '  ', date: '2026-10-30' }, V41_NOW)).toEqual({ name: NAME_ERROR });
    expect(checkOther({ name: 'Lunch', date: '2026-11-05' }, V41_NOW)).toEqual({ date: DATE_ERROR });
    expect(checkOther({ name: 'Lunch', date: '2026-11-02' }, V41_NOW)).toEqual({});
    expect(checkOther({ name: 'Lunch', date: '' }, V41_NOW)).toEqual({ date: DATE_ERROR });
  });

  it('otherParams: attendees as names or emails joined by "|"', () => {
    expect(otherParams({ ...V41_FORM, attendees: [{ name: 'Dana Ruiz' }, { email: 'sam@x.co' }] }).who).toBe('Dana Ruiz|sam@x.co');
    expect(otherParams({ ...V41_FORM, attendees: [] }).who).toBeUndefined();
  });
});
