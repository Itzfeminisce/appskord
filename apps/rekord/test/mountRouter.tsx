// Test helper: mounts one surface's router on a memory history (needs the happy-dom environment).
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';
import { createMemoryHistory, type RouterHistory } from '@appskord/platform/router';
import { useRouter, type createRouter, type Router, type ScreenName } from '../entrypoints/sidepanel/router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Surface = ReturnType<typeof createRouter>;

const mounted: (() => void)[] = [];
afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); });

/** Renders a surface on a memory history at `href`, the way an entrypoint mounts it. */
export async function mount(surface: Surface, initial: ScreenName, href = '/', history?: RouterHistory) {
  const memory = history ?? createMemoryHistory({ initialEntries: [href] });
  const seen: { router?: Router } = {};
  const visited: ScreenName[] = [];
  function Probe() {
    seen.router = useRouter();
    if (visited.at(-1) !== seen.router.route.screen) visited.push(seen.router.route.screen);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <surface.RouterProvider initial={{ screen: initial, params: {} }} history={memory}>
        <Probe />
      </surface.RouterProvider>,
    );
  });
  await settle();
  mounted.push(() => { act(() => root.unmount()); host.remove(); });
  return {
    host,
    history: memory,
    /** Screens shown in order, including any a screen's own flow moved on to. */
    visited,
    get router(): Router {
      if (!seen.router) throw new Error('no route rendered');
      return seen.router;
    },
  };
}

export async function settle() {
  for (let i = 0; i < 3; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

export const shown = (host: HTMLElement) => host.querySelector('[data-test-screen]')?.getAttribute('data-test-screen');
export const fakeScreen = (name: string): ComponentType => () => <p data-test-screen={name}>{name}</p>;

/** Polls (letting React and IndexedDB work) until `check` neither throws nor returns false; then its result. */
export async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 4000): Promise<Exclude<T, false>> {
  const until = Date.now() + timeoutMs;
  let last: unknown = new Error('waitFor: condition stayed false');
  for (;;) {
    try {
      const value = await check();
      if (value !== false) return value as Exclude<T, false>;
    } catch (error) {
      last = error;
    }
    if (Date.now() > until) throw last;
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
}
