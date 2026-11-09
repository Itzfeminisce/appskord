// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { sidepanel } from '../../entrypoints/sidepanel/router';
import { mount } from '../../test/mountRouter';
import { flow } from './flow';
import { fakeFlow, press, until } from './mountPanel';
import { fivePalette, mix } from './palette';

vi.mock('../../lib/db', async (orig) => ({ ...(await orig<typeof import('../../lib/db')>()), listClips: async () => [], getBrandKit: async () => undefined }));

const open = async () => {
  const view = await mount(sidepanel, 'LookLock');
  await view.router.navigate('LookBible');
  await until(() => view.host.textContent!.includes('Look guide'));
  return view;
};

describe('LookBible', () => {
  beforeEach(() => { fakeFlow(); });

  it('shows the frame copy', async () => {
    const { host } = await open();
    for (const text of [
      'Look guide', 'One set of rules every scene follows.', 'Live preview · Scene 1', 'Changes show here as you make them.',
      'Smooth · Gentle push · Fine grain', 'Palette', 'From pack: Studio', 'Ground', 'Ink', 'Glow', 'Panel', 'Muted',
      'Type pair', 'Heading', 'Geist 600', 'Body', 'Geist Mono', 'Weight moves', 'Headings grow from', 'light', 'heavy', 'as they enter',
      'Motion feel', 'Smooth', 'Snappy', 'Bouncy', 'Steady', 'Floaty', 'Ease out · 600 ms', 'Light', 'Softness', 'Texture', 'Grain', 'Off', 'Fine', 'Film',
      'Glow', 'Camera habit', 'Hold', 'Gentle push', 'Lively', 'Name this guide', 'Save as a look guide', 'Use for this clip',
    ]) expect(host.textContent, text).toContain(text);
    expect(host.querySelector('[aria-label="Ground colour #0B0B10. Change"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Light from top left. Change direction"]')).toBeNull();
    expect(host.querySelector('[aria-label="Light from the top. Change direction"]')).not.toBeNull();
  });

  it('changes the feel, texture and camera habit, and the summary follows', async () => {
    const { host } = await open();
    await press(host, 'Bouncy');
    await press(host, 'Film');
    await press(host, 'Lively');
    expect(host.textContent).toContain('Bouncy · Lively · Film grain');
    expect(host.textContent).toContain('Spring · 50% bounce');
  });

  it('Use for this clip gives the flow the edited guide and goes back', async () => {
    const view = await open();
    await press(view.host, 'Snappy');
    await press(view.host, 'Use for this clip');
    expect(flow.get().look.feel).toBe('snappy');
    expect(view.router.route.screen).toBe('LookLock');
  });

  it('saves a named guide and lists it under Your look guides', async () => {
    const { host } = await open();
    const name = host.querySelector<HTMLInputElement>('input[placeholder]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(name, 'Fieldnote brand');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await press(host, 'Save as a look guide');
    await until(() => host.textContent!.includes('Your look guides'));
    expect(host.textContent).toContain('Your look guides');
    expect(host.textContent).toContain('Fieldnote brand');
    expect(host.textContent).toContain('Studio · Smooth');
  });

  it('fills the Panel and Muted slots a pack leaves out', () => {
    expect(fivePalette(['#0B0B10', '#F5F5F7', '#8B9CFF'])).toHaveLength(5);
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});
