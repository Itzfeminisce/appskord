// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test/mountRouter';
import { sidepanel } from './router';

describe('side panel routes', () => {
  beforeEach(() => { vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '0.0.1' } as never); });

  it('renders each route as its screen', { timeout: 20_000 }, async () => {
    for (const name of sidepanel.names) {
      const view = await mount(sidepanel, 'Home', `/${name}`);
      expect(view.visited[0]).toBe(name);
      expect(view.host.innerHTML, name).not.toBe('');
    }
  });

  it('Back returns to the previous screen, and a reload keeps the screen', { timeout: 20_000 }, async () => {
    const view = await mount(sidepanel, 'Home');
    for (const name of ['Library', 'Settings', 'Privacy'] as const) {
      act(() => view.router.navigate(name));
      await settle();
    }
    act(() => view.router.back());
    await settle();
    expect(view.router.route.screen).toBe('Settings');
    const again = await mount(sidepanel, 'Home', view.history.location.href);
    expect(again.router.route.screen).toBe('Settings');
  });
});
