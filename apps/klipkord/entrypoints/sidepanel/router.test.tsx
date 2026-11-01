// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { mount, settle } from '../../test/mountRouter';
import { sidepanel } from './App';

describe('side panel routes', () => {
  it('renders each route as its screen', async () => {
    for (const name of sidepanel.names) {
      const view = await mount(sidepanel, 'Home', `/${name}`);
      // Countdown holds its picked source in memory, so a fresh load opens the first screen, as before.
      expect(view.visited[0]).toBe(name === 'Countdown' ? 'Home' : name);
      expect(view.host.innerHTML, name).not.toBe('');
    }
  });

  it('Back returns to the previous screen, and a reload keeps the screen', async () => {
    const view = await mount(sidepanel, 'Home');
    for (const name of ['Library', 'Settings', 'Storage'] as const) {
      act(() => view.router.navigate(name));
      await settle();
    }
    act(() => view.router.back());
    await settle();
    expect(view.router.route.screen).toBe('Settings');
    const again = await mount(sidepanel, 'Home', view.history.location.href);
    expect(again.router.route.screen).toBe('Settings');
  });

  it('switching Review tabs keeps the time in the URL for Back and reload', async () => {
    const view = await mount(sidepanel, 'Library');
    act(() => view.router.navigate('ReviewTranscript', { recordingId: 'rec-1', atMs: 1500 }));
    await settle();
    expect(view.history.location.href).toBe('/ReviewTranscript?recording=rec-1&at=1500');
    const again = await mount(sidepanel, 'Home', view.history.location.href);
    expect(again.router.route).toEqual({ screen: 'ReviewTranscript', params: { recordingId: 'rec-1', atMs: 1500 } });
  });
});
