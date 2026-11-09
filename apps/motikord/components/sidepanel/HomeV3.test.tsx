// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test/mountRouter';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { draft } from '../../lib/makeClip';
import { flow } from './flow';
import { fakeFlow, press, until } from './mountPanel';

vi.mock('../../lib/db', async (orig) => ({ ...(await orig<typeof import('../../lib/db')>()), listClips: async () => [], getBrandKit: async () => undefined }));

describe('HomeV3', () => {
  beforeEach(() => { fakeFlow(); draft.clear(); });

  it('shows the frame copy', async () => {
    const { host } = await mount(sidepanel, 'HomeV3');
    for (const text of [
      'Motikord', 'NEW IN MOTIKORD 3', 'Motion that looks made today', 'Depth, camera moves and kinetic type.', 'See what’s new',
      'What should the clip show?', 'Your media', 'Clip type', 'Look guide', 'Starts as', 'Length', 'Auto', 'up to 60 s',
      'Every clip comes in all three sizes. This one opens first.', 'Make clip', 'Start from a template', 'ready-made clips in 8 looks',
    ]) expect(host.textContent, text).toContain(text);
    expect([...host.querySelectorAll('[role=radiogroup][aria-label=Style] [role=radio]')].map((r) => r.getAttribute('aria-label')))
      .toEqual(['Clean', 'Bold', 'Playful', 'Corporate', 'Studio', 'Kinetic', 'Gloss', 'Soft']);
  });

  it('keeps Make clip off until there are words, then plans and goes to Look lock', async () => {
    const view = await mount(sidepanel, 'HomeV3');
    const make = [...view.host.querySelectorAll('button')].find((b) => b.textContent === 'Make clip')!;
    expect(make.hasAttribute('disabled')).toBe(true);
    act(() => draft.set({ prompt: 'An 18-second launch for Fieldnote 2.0.' }));
    await settle();
    await press(view.host, 'Make clip');
    expect(view.router.route.screen).toBe('LookLock');
    await until(() => flow.get().stage === 'keyframes');
    expect(flow.get().stage).toBe('keyframes');
    expect(flow.get().board?.frames).toHaveLength(5);
  });

  it('wires the rows, the style and the what’s-new card', async () => {
    const view = await mount(sidepanel, 'HomeV3');
    await press(view.host, 'Gloss');
    expect(flow.get().packId).toBe('gloss');
    await press(view.host, 'Your media');
    expect(view.router.route.screen).toBe('YourMedia');
    act(() => view.router.back());
    await settle();
    await press(view.host, /^Look guide/);
    expect(view.router.route.screen).toBe('LookBible');
    act(() => view.router.back());
    await settle();
    await press(view.host, /^Start from a template/);
    expect(view.router.route.screen).toBe('TemplatesListV3');
    act(() => view.router.back());
    await settle();
    await press(view.host, 'Your clips');
    expect(view.router.route.screen).toBe('LibraryV3');
  });

  it('keeps Speak in the prompt box, Grab from this page, and the privacy footer', async () => {
    const { host } = await mount(sidepanel, 'HomeV3');
    expect(host.querySelector('button[aria-label="Speak your prompt"]')?.textContent).toBe('Speak');
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Grab from this page')).toBe(true);
    expect(host.textContent).toContain('writes the clip from your words. Your media stays on this computer.');
  });

  it('shows the v1 offline banner above the prompt, and drops it when back online', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { host } = await mount(sidepanel, 'HomeV3');
    expect(host.textContent).toContain('You’re offline');
    expect(host.textContent).toContain('Making and changing clips with words needs the internet.');
    act(() => { online.mockReturnValue(true); window.dispatchEvent(new Event('online')); });
    await settle();
    expect(host.textContent).not.toContain('You’re offline');
    online.mockRestore();
  });

  it('opens What’s new from the card and dismisses it for good', async () => {
    const view = await mount(sidepanel, 'HomeV3');
    await press(view.host, 'Dismiss');
    expect(view.host.querySelector('[aria-label="New in Motikord"]')).toBeNull();
    const again = await mount(sidepanel, 'HomeV3');
    expect(again.host.querySelector('[aria-label="New in Motikord"]')).toBeNull();
  });
});
