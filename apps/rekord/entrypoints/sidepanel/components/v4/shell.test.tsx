// @vitest-environment happy-dom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDB, getDB } from '@/lib/db';
import { SAMPLE_EVENT, SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { mount, settle } from '../../../../test/mountRouter';
import { sidepanel } from '../../App';
import { nearMeeting } from './recordBar';
import { world } from './world';

const MIN = 60_000;

describe('record bar timing', () => {
  const start = SAMPLE_EVENT.start;
  it('names a meeting from 10 minutes before it starts until 10 minutes after, while it runs', () => {
    expect(nearMeeting([SAMPLE_EVENT], start - 11 * MIN)).toBeUndefined();
    expect(nearMeeting([SAMPLE_EVENT], start - 10 * MIN)?.id).toBe(SAMPLE_EVENT.id);
    expect(nearMeeting([SAMPLE_EVENT], start + 10 * MIN)?.id).toBe(SAMPLE_EVENT.id);
    expect(nearMeeting([SAMPLE_EVENT], start + 11 * MIN)).toBeUndefined();
    expect(nearMeeting([{ ...SAMPLE_EVENT, end: start + 5 * MIN }], start + 6 * MIN)).toBeUndefined();
  });

  it('picks the closest start', () => {
    const later = { ...SAMPLE_EVENT, id: 'later', start: start + 8 * MIN, end: start + 60 * MIN };
    expect(nearMeeting([later, SAMPLE_EVENT], start - 2 * MIN)?.id).toBe(SAMPLE_EVENT.id);
  });
});

describe('v4 shell', () => {
  beforeEach(async () => {
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await seedSample(await getDB());
  });
  afterEach(() => {
    world.now = () => Date.now();
    world.events = undefined;
  });

  it('home shows the tabs with the overdue count and the record bar', async () => {
    world.now = () => SAMPLE_NOW;
    const view = await mount(sidepanel, 'home');
    await settle();
    const tabs = [...view.host.querySelectorAll('.v4-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Open loops1', 'Meetings', 'People']);
    expect(view.host.querySelector('.v4-tab[aria-current="page"]')?.textContent).toBe('Open loops1');
    expect(view.host.querySelector('.v4-record-btn')?.textContent).toBe('Start recording');
    expect(view.host.querySelector('.v4-brief')).toBeNull();
  });

  it('within 10 minutes of a calendar meeting the bar records it and offers the brief', async () => {
    world.now = () => SAMPLE_NOW;
    world.events = [SAMPLE_EVENT];
    const view = await mount(sidepanel, 'home');
    expect(view.host.querySelector('.v4-record-btn')?.textContent).toBe('Record 1:1 with Sarah');
    expect(view.host.querySelector('.v4-brief')?.textContent).toBe('Brief');
  });

  it('Meetings opens the library; People opens its screen', async () => {
    const view = await mount(sidepanel, 'home');
    const [, , people] = view.host.querySelectorAll<HTMLButtonElement>('.v4-tab');
    expect(people!.getAttribute('aria-disabled')).toBeNull();
    people!.click();
    await settle();
    expect(view.router.route.screen).toBe('people');
    view.host.querySelectorAll<HTMLButtonElement>('.v4-tab')[1]!.click();
    await settle();
    expect(view.router.route.screen).toBe('library');
  });
});
