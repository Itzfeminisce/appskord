// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';
import { flow } from './flow';
import { fakeFlow, opened, press, saved, until } from './mountPanel';

vi.mock('../../lib/db', async (orig) => ({ ...(await orig<typeof import('../../lib/db')>()), listClips: async () => [], getBrandKit: async () => undefined }));

const look = { style: 'auto', pace: 'normal', mood: 'upbeat' } as const;
async function approvedAndChecking() {
  await flow.plan({ prompt: 'An 18-second launch for Fieldnote 2.0.', attached: [] }, look);
  await until(() => flow.get().stage === 'keyframes');
  await flow.approveAll();
  void flow.addTheMotion();
  await until(() => flow.get().stage === 'checking');
}

describe('MakingMotion', () => {
  beforeEach(() => { fakeFlow(() => new Promise(() => undefined)); });

  it('shows the frame copy while the quality check runs', async () => {
    await approvedAndChecking();
    const { host } = await mount(sidepanel, 'MakingMotion');
    for (const text of [
      'Making your clip', 'Key frames locked. Motikord is adding the motion.', 'Key frames approved', '5 of 5',
      'Adding motion to scene 5 of 5', 'Springs, camera and depth, on this computer.',
      'Quality check', 'Story · Same look throughout · Look and motion', 'Opening the editor',
      'Export renders every frame at full quality. A slower computer takes longer, never looks worse.',
      'Open the editor now', 'Cancel', 'Your words and up to 8 small frames go to Groq. Your media stays on this computer.',
    ]) expect(host.textContent, text).toContain(text);
    expect([...host.querySelectorAll('[role=img]')].map((e) => e.getAttribute('aria-label')).filter((l) => l !== 'Done' && l !== 'Working' && l !== 'Not started')[0]).toMatch(/^Scene \d preview, moving: /);
  });

  it('marks each step as the flow moves', async () => {
    await approvedAndChecking();
    const { host } = await mount(sidepanel, 'MakingMotion');
    const steps = [...host.querySelectorAll('li [role=img]')].map((e) => e.getAttribute('aria-label'));
    expect(steps).toEqual(['Done', 'Done', 'Working', 'Not started']);
  });

  it('Open the editor now saves the clip as it is and opens it', async () => {
    await approvedAndChecking();
    const { host } = await mount(sidepanel, 'MakingMotion');
    await press(host, 'Open the editor now');
    await until(() => opened.length === 1);
    expect(opened).toEqual(['c1']);
    expect(saved).toHaveLength(1);
  });

  it('keeps the open button off until the motion is made, and Cancel returns to the key frames', async () => {
    await flow.plan({ prompt: 'x', attached: [] }, look);
    await until(() => flow.get().stage === 'keyframes');
    const view = await mount(sidepanel, 'MakingMotion');
    expect([...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Open the editor now')!.hasAttribute('disabled')).toBe(true);
    await press(view.host, 'Cancel');
    expect(view.router.route.screen).toBe('LookLock');
  });
});
