// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { mount, settle } from '../../test/mountRouter';
import { sidepanel } from './App';

describe('side panel routes', () => {
  it('renders each route as its screen', async () => {
    for (const name of sidepanel.names) {
      const view = await mount(sidepanel, 'start', `/${name}`);
      // These keep their return path in memory, so a fresh load opens the first screen, as before.
      expect(view.visited[0]).toBe(name === 'googleConnect' || name === 'notionPage' ? 'start' : name);
      expect(view.host.innerHTML, name).not.toBe('');
    }
  });

  it('Back returns to the previous screen, and a reload keeps the screen', async () => {
    const view = await mount(sidepanel, 'start');
    for (const name of ['library', 'settings', 'settingsMore'] as const) {
      act(() => view.router.navigate(name));
      await settle();
    }
    act(() => view.router.back());
    await settle();
    expect(view.router.route.screen).toBe('settings');
    const again = await mount(sidepanel, 'start', view.history.location.href);
    expect(again.router.route.screen).toBe('settings');
  });

  it('keeps the meeting and time in the URL for Back and reload, and nothing else', async () => {
    const view = await mount(sidepanel, 'library');
    act(() => view.router.navigate('transcript', { meetingId: 'meet-1', atMs: 1500 }));
    await settle();
    expect(view.history.location.href).toBe('/transcript?meeting=meet-1&at=1500');
    const again = await mount(sidepanel, 'start', view.history.location.href);
    expect(again.router.route).toEqual({ screen: 'transcript', params: { meetingId: 'meet-1', atMs: 1500 } });
  });
});
