// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';
import { draft } from '../../lib/makeClip';
import { flow, flowDeps } from './flow';
import { fakeFlow, opened, press, saved, until } from './mountPanel';

vi.mock('../../lib/db', async (orig) => ({ ...(await orig<typeof import('../../lib/db')>()), listClips: async () => [], getBrandKit: async () => undefined }));

const look = { style: 'auto', pace: 'normal', mood: 'upbeat' } as const;
const planned = async () => {
  draft.clear();
  await flow.plan({ prompt: 'An 18-second launch for Fieldnote 2.0.', attached: [] }, look);
  await until(() => flow.get().stage === 'keyframes');
};

describe('LookLock', () => {
  beforeEach(() => { fakeFlow(); });

  it('says it is drawing while the story is planned', async () => {
    flowDeps.plan = () => new Promise(() => undefined);
    void flow.plan({ prompt: 'x', attached: [] }, look);
    const { host } = await mount(sidepanel, 'LookLock');
    expect(host.textContent).toContain('Check the key frames');
    expect(host.textContent).toContain('Drawing your key frames…');
  });

  it('shows the frame copy for five scenes', async () => {
    await planned();
    const { host } = await mount(sidepanel, 'LookLock');
    for (const text of [
      'Look lock', 'Check the key frames', 'One still per scene in your look. Approve them, then Motikord adds the motion. No AI cost.',
      '5 scenes · 15 s · Studio', 'Approve all', 'Title hook', 'Big statement', 'Stat reveal', 'List', 'End card', 'Waiting', 'Try another',
      'Approve 5 more to add the motion', '0/5', 'Add the motion', 'Motion is added on this computer. No AI cost.', 'Change the look', 'Cancel',
      'Your words go to Groq. Your media stays on this computer.',
    ]) expect(host.textContent, text).toContain(text);
    expect(host.querySelector('[aria-label="Scene 1 still: Fieldnote 2.0. Notes that find you."]')).not.toBeNull();
  });

  it('approves one at a time, then all; the footer follows', async () => {
    await planned();
    const { host } = await mount(sidepanel, 'LookLock');
    const approve = () => [...host.querySelectorAll('li button')].filter((b) => b.textContent === 'Approve');
    await press(host, 'Approve'); // first card's button
    expect(host.textContent).toContain('Approve 4 more to add the motion');
    expect(host.textContent).toContain('1/5');
    expect(host.textContent).toContain('Approved');
    expect(approve().length).toBe(5);
    await press(host, 'Approve all');
    expect(flow.get().board!.frames.every((f) => f.status === 'approved')).toBe(true);
    expect(host.textContent).not.toContain('more to add the motion');
    expect([...host.querySelectorAll('button')].find((b) => b.textContent === 'Add the motion')!.hasAttribute('disabled')).toBe(false);
  });

  it('draws another key frame for one scene', async () => {
    await planned();
    const { host } = await mount(sidepanel, 'LookLock');
    await press(host, 'Try another');
    await until(() => flow.get().drawing.length === 0 && flow.get().board!.frames[0]!.variant === 1);
    expect(flow.get().board!.frames[0]!.variant).toBe(1);
  });

  it('keeps Add the motion off until every frame is approved, then moves to Making your clip', async () => {
    await planned();
    const view = await mount(sidepanel, 'LookLock');
    const add = () => [...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Add the motion')!;
    expect(add().hasAttribute('disabled')).toBe(true);
    await press(view.host, 'Approve all');
    await press(view.host, 'Add the motion');
    expect(view.router.route.screen).toBe('MakingMotion');
    await until(() => opened.length === 1);
    expect(flow.get().stage).toBe('opening');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.id).toBe('c1');
    expect((saved[0] as unknown as { v3: { version: number; scenes: unknown[] } }).v3).toMatchObject({ version: 3, packId: 'studio' });
    expect((saved[0] as unknown as { v3: { scenes: unknown[] } }).v3.scenes).toHaveLength(5);
  });

  it('changes the look and cancels', async () => {
    await planned();
    const view = await mount(sidepanel, 'LookLock');
    await press(view.host, 'Change the look');
    expect(view.router.route.screen).toBe('LookBible');
    view.router.back();
    await until(() => view.router.route.screen === 'LookLock');
    await press(view.host, 'Cancel');
    expect(view.router.route.screen).toBe('HomeV3');
    expect(flow.get().stage).toBe('idle');
  });
});
