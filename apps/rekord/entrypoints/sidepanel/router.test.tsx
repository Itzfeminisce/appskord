// @vitest-environment happy-dom
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { createHashHistory } from '@appskord/platform/router';
import { fakeScreen as screen, mount, settle, shown } from '../../test/mountRouter';
import { createRouter } from './router';

const fake = createRouter(
  {
    start: screen('start'), library: screen('library'), settings: screen('settings'), connections: screen('connections'),
    googleConnect: screen('googleConnect'), live: screen('live'), processing: screen('processing'), transcript: screen('transcript'),
  },
  { fresh: ['googleConnect'], hold: ['live'] },
);

async function step(run: () => void) {
  act(run);
  await settle();
}

describe('side panel router on TanStack Router', () => {
  it('opens the initial screen when the hash names none, and on an unknown path', async () => {
    expect(shown((await mount(fake, 'library')).host)).toBe('library');
    expect(shown((await mount(fake, 'library', '/nope')).host)).toBe('library');
  });

  it('renders each route as its screen', async () => {
    for (const name of fake.names) {
      expect(shown((await mount(fake, 'start', `/${name}`)).host)).toBe(name === 'googleConnect' ? 'start' : name);
    }
  });

  it('Back returns to the previous screen and its params; replace clears the back stack', async () => {
    const view = await mount(fake, 'start');
    expect(view.router.canGoBack).toBe(false);
    await step(() => view.router.navigate('transcript', { meetingId: 'm-1', atMs: 4500 }));
    await step(() => view.router.navigate('settings'));
    expect(view.router.canGoBack).toBe(true);
    await step(() => view.router.back());
    expect(view.router.route).toEqual({ screen: 'transcript', params: { meetingId: 'm-1', atMs: 4500 } });
    await step(() => view.router.replace('start'));
    expect(view.router.canGoBack).toBe(false);
  });

  it('a reload keeps the screen and its params, ids staying strings', async () => {
    const view = await mount(fake, 'start');
    await step(() => view.router.navigate('transcript', { meetingId: '0042', atMs: 7 }));
    expect(view.history.location.href).toBe('/transcript?meeting=0042&at=7');
    const again = await mount(fake, 'start', view.history.location.href);
    expect(again.router.route).toEqual({ screen: 'transcript', params: { meetingId: '0042', atMs: 7 } });
  });

  it('runs back-then-navigate, replace-then-navigate and back twice in order, as the screens call them', async () => {
    const view = await mount(fake, 'start');
    await step(() => view.router.navigate('settings'));
    await step(() => view.router.navigate('googleConnect'));
    await step(() => { view.router.back(); view.router.navigate('connections'); });
    expect(view.router.route.screen).toBe('connections');
    await step(() => view.router.back());
    expect(view.router.route.screen).toBe('settings');
    await step(() => { view.router.replace('start'); view.router.navigate('connections'); });
    expect(view.router.route.screen).toBe('connections');
    await step(() => view.router.back());
    expect(view.router.route.screen).toBe('start');
    expect(view.router.canGoBack).toBe(false);
    await step(() => { view.router.navigate('settings'); view.router.navigate('library'); });
    await step(() => { view.router.back(); view.router.back(); });
    expect(view.router.route.screen).toBe('start');
  });

  it('keeps navigate, replace and back the same functions across screens', async () => {
    const view = await mount(fake, 'start');
    const { navigate, replace, back } = view.router;
    await step(() => navigate('library'));
    expect(view.router.navigate).toBe(navigate);
    expect(view.router.replace).toBe(replace);
    expect(view.router.back).toBe(back);
  });

  it('a reload on a fresh screen opens the first screen, as before; navigating there still works', async () => {
    expect(shown((await mount(fake, 'start', '/googleConnect')).host)).toBe('start');
    const view = await mount(fake, 'start');
    await step(() => view.router.navigate('googleConnect'));
    expect(shown(view.host)).toBe('googleConnect');
  });

  it('a swallowed back() does not block the navigate queued after it', async () => {
    const view = await mount(fake, 'start');
    await step(() => view.router.navigate('settings'));
    const original = view.history.back.bind(view.history);
    view.history.back = () => {};
    act(() => { view.router.back(); view.router.navigate('library'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    await settle();
    view.history.back = original;
    expect(view.router.route.screen).toBe('library');
  });

  it('a reload redirect to the first screen sets the back floor', async () => {
    const view = await mount(fake, 'start', '/googleConnect');
    expect(shown(view.host)).toBe('start');
    expect(view.router.canGoBack).toBe(false);
    expect(view.history.location.state).toMatchObject({ appskordFloor: expect.any(Number) });
  });

  it('Back and Forward cannot leave Live, and Live stays mounted; its own replace and navigate still move on', async () => {
    // The browser's Back is a popstate, so this test runs on hash history like the extension.
    window.location.hash = '';
    const history = createHashHistory();
    const view = await mount(fake, 'start', '/', history);
    await step(() => view.router.navigate('library'));
    await step(() => view.router.navigate('live', { meetingId: 'm-1' }));
    const live = view.host.querySelector('[data-test-screen]');
    await popBack();
    expect(view.router.route).toEqual({ screen: 'live', params: { meetingId: 'm-1' } });
    expect(view.host.querySelector('[data-test-screen]')).toBe(live);
    await step(() => view.router.back());
    expect(view.host.querySelector('[data-test-screen]')).toBe(live);
    await step(() => view.router.navigate('transcript', { meetingId: 'm-1', atMs: 100 }));
    await popBack();
    expect(shown(view.host)).toBe('live');
    await step(() => view.router.replace('processing', { meetingId: 'm-1' }));
    expect(shown(view.host)).toBe('processing');
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
