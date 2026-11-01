// @vitest-environment happy-dom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, settle } from '../../test/mountRouter';
import { editor } from './router';

describe('editor tab routes', () => {
  beforeEach(() => { vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '0.0.1' } as never); });

  it('renders each route as its screen', async () => {
    // Library and YourMedia are side panel screens listed here as stand-ins; they need the side panel's router, as before M7.
    for (const name of editor.names.filter((n) => n !== 'Library' && n !== 'YourMedia')) {
      const view = await mount(editor, 'Editor', `/${name}`);
      expect(view.visited[0]).toBe(name);
      expect(view.host.innerHTML, name).not.toBe('');
    }
  });

  it('Back returns to the previous screen, and a reload keeps the screen', async () => {
    const view = await mount(editor, 'Editor');
    for (const name of ['Music', 'Credits', 'Export'] as const) {
      act(() => view.router.navigate(name));
      await settle();
    }
    act(() => view.router.back());
    await settle();
    expect(view.router.route.screen).toBe('Credits');
    const again = await mount(editor, 'Editor', view.history.location.href);
    expect(again.router.route.screen).toBe('Credits');
  });
});
