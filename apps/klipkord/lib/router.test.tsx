// @vitest-environment happy-dom
import { act, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { createHashHistory } from '@appskord/platform/router';
import { fakeScreen as screen, mount, settle, shown } from '../test/mountRouter';
import { createRouter } from './router';

const fake = createRouter({ Home: screen('Home'), Library: screen('Library'), Settings: screen('Settings') });

describe('createRouter on TanStack Router', () => {
  it('opens the initial screen when the hash names none, and on an unknown path', async () => {
    expect(shown((await mount(fake, 'Library')).host)).toBe('Library');
    expect(shown((await mount(fake, 'Library', '/Nope')).host)).toBe('Library');
  });

  it('renders each route as its screen', async () => {
    for (const name of fake.names) expect(shown((await mount(fake, 'Home', `/${name}`)).host)).toBe(name);
  });

  it('Back returns to the previous screen and its params; replace clears the back stack', async () => {
    const view = await mount(fake, 'Home');
    expect(view.router.canGoBack).toBe(false);
    act(() => view.router.navigate('Library', { recordingId: '123', atMs: 4500 }));
    await settle();
    act(() => view.router.navigate('Settings'));
    await settle();
    expect(view.router.canGoBack).toBe(true);
    act(() => view.router.back());
    await settle();
    expect(shown(view.host)).toBe('Library');
    expect(view.router.route).toEqual({ screen: 'Library', params: { recordingId: '123', atMs: 4500 } });
    act(() => view.router.replace('Home'));
    await settle();
    expect(view.router.canGoBack).toBe(false);
  });

  it('a reload keeps the screen and its params, ids staying strings', async () => {
    const view = await mount(fake, 'Home');
    act(() => view.router.navigate('Library', { recordingId: '0042', atMs: 7 }));
    await settle();
    expect(view.history.location.href).toBe('/Library?recording=0042&at=7');
    const again = await mount(fake, 'Home', view.history.location.href);
    expect(again.router.route).toEqual({ screen: 'Library', params: { recordingId: '0042', atMs: 7 } });
  });

  it('keeps navigate, replace and back the same functions across screens', async () => {
    const view = await mount(fake, 'Home');
    const { navigate, replace, back } = view.router;
    act(() => navigate('Library'));
    await settle();
    expect(view.router.navigate).toBe(navigate);
    expect(view.router.replace).toBe(replace);
    expect(view.router.back).toBe(back);
  });
});

describe('surface options', () => {
  function Counter() {
    const [n] = useState(() => Math.random());
    return <p data-test-screen="tab" data-n={n} />;
  }
  const tabs = createRouter(
    { Home: screen('Home'), Review: Counter, ReviewAsk: Counter, Countdown: screen('Countdown'), Recording: screen('Recording') },
    {
      key: (route) => (route.screen.startsWith('Review') ? 'Review' : route.screen),
      fresh: ['Countdown'],
      hold: ['Countdown', 'Recording'],
    },
  );

  it('routes with one key keep one mounted screen', async () => {
    const view = await mount(tabs, 'Review');
    const before = view.host.querySelector('p')?.getAttribute('data-n');
    act(() => view.router.replace('ReviewAsk'));
    await settle();
    expect(view.router.route.screen).toBe('ReviewAsk');
    expect(view.host.querySelector('p')?.getAttribute('data-n')).toBe(before);
  });

  it('a reload on a fresh screen opens the first screen, as before; navigating there still works', async () => {
    expect(shown((await mount(tabs, 'Home', '/Countdown')).host)).toBe('Home');
    const view = await mount(tabs, 'Home');
    act(() => view.router.navigate('Countdown'));
    await settle();
    expect(shown(view.host)).toBe('Countdown');
  });

  it('Back and Forward cannot leave a held screen; its own replace still moves on', async () => {
    // The browser's Back is a popstate, so this test runs on hash history like the extension.
    window.location.hash = '';
    const history = createHashHistory();
    const view = await mount(tabs, 'Home', '/', history);
    act(() => view.router.navigate('Countdown'));
    await settle();
    await popBack();
    expect(shown(view.host)).toBe('Countdown');
    act(() => view.router.replace('Recording'));
    await settle();
    await popBack();
    expect(shown(view.host)).toBe('Recording');
    act(() => view.router.replace('Home'));
    await settle();
    expect(shown(view.host)).toBe('Home');
    history.destroy();
  });
});

async function popBack() {
  await act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 50));
  });
  await settle();
}
