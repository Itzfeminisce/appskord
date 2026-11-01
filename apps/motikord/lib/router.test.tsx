// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fakeScreen as screen, mount, settle, shown } from '../test/mountRouter';
import { createRouter } from './router';

const fake = createRouter({ A: screen('A'), B: screen('B'), C: screen('C') });

describe('createRouter on TanStack Router', () => {
  it('opens the initial screen when the hash names none, and on an unknown path', async () => {
    expect(shown((await mount(fake, 'B')).host)).toBe('B');
    expect(shown((await mount(fake, 'B', '/Nope')).host)).toBe('B');
  });

  it('renders each route as its screen', async () => {
    for (const name of fake.names) expect(shown((await mount(fake, 'A', `/${name}`)).host)).toBe(name);
  });

  it('Back returns to the previous screen and its params', async () => {
    const view = await mount(fake, 'A');
    expect(view.router.canGoBack).toBe(false);
    act(() => view.router.navigate('B', { clipId: '123' }));
    await settle();
    act(() => view.router.navigate('C'));
    await settle();
    expect(shown(view.host)).toBe('C');
    expect(view.router.canGoBack).toBe(true);
    act(() => view.router.back());
    await settle();
    expect(shown(view.host)).toBe('B');
    expect(view.router.route).toEqual({ screen: 'B', params: { clipId: '123' } });
    act(() => view.router.back());
    await settle();
    expect(shown(view.host)).toBe('A');
    expect(view.router.canGoBack).toBe(false);
  });

  it('keeps ids as strings in typed search params', async () => {
    const view = await mount(fake, 'A');
    act(() => view.router.navigate('B', { clipId: '123', sceneId: 's1', layerId: 'l1' }));
    await settle();
    expect(view.history.location.pathname).toBe('/B');
    expect(view.history.location.search).toBe('?clip=123&scene=s1&layer=l1');
    expect(view.router.route.params).toEqual({ clipId: '123', sceneId: 's1', layerId: 'l1' });
  });

  it('replace clears the back stack, and later screens stop there', async () => {
    const view = await mount(fake, 'A');
    act(() => view.router.navigate('B'));
    await settle();
    act(() => view.router.replace('C'));
    await settle();
    expect(view.router.canGoBack).toBe(false);
    act(() => view.router.navigate('A'));
    await settle();
    act(() => view.router.back());
    await settle();
    expect(shown(view.host)).toBe('C');
    act(() => view.router.back());
    await settle();
    expect(shown(view.host)).toBe('C');
  });

  it('keeps navigate, replace and back the same functions across navigations', async () => {
    const view = await mount(fake, 'A');
    const { navigate, replace, back } = view.router;
    act(() => navigate('B'));
    await settle();
    act(() => replace('C'));
    await settle();
    expect(view.router.navigate).toBe(navigate);
    expect(view.router.replace).toBe(replace);
    expect(view.router.back).toBe(back);
  });

  it('functions held from an earlier screen use the current back floor', async () => {
    const view = await mount(fake, 'A');
    const { navigate, back } = view.router;
    act(() => view.router.replace('B'));
    await settle();
    act(() => navigate('C'));
    await settle();
    act(() => back());
    await settle();
    expect(shown(view.host)).toBe('B');
    act(() => back());
    await settle();
    expect(shown(view.host)).toBe('B');
    expect(view.router.canGoBack).toBe(false);
  });

  it('a reload keeps the screen and its params', async () => {
    const view = await mount(fake, 'A');
    act(() => view.router.navigate('C', { clipId: 'c9' }));
    await settle();
    const again = await mount(fake, 'A', view.history.location.href);
    expect(shown(again.host)).toBe('C');
    expect(again.router.route.params).toEqual({ clipId: 'c9' });
  });

  it('has no dev route outside dev builds', async () => {
    expect(shown((await mount(fake, 'A', '/dev/C')).host)).toBe('A');
  });

  it('opens a screen by frame name on the dev route in dev builds', async () => {
    (globalThis as { __MOTIKORD_DEV_TOOLS__?: boolean }).__MOTIKORD_DEV_TOOLS__ = true;
    vi.resetModules();
    try {
      const dev = await import('./router');
      const surface = dev.createRouter({ A: screen('A'), B: screen('B') });
      expect(shown((await mount(surface, 'A', '/dev/B')).host)).toBe('B');
      expect(shown((await mount(surface, 'A', '/dev/Nope')).host)).toBe('A');
    } finally {
      delete (globalThis as { __MOTIKORD_DEV_TOOLS__?: boolean }).__MOTIKORD_DEV_TOOLS__;
      vi.resetModules();
    }
  });
});
