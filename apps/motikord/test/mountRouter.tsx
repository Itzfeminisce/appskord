// Test helper: mounts one surface's router on a memory history (needs the happy-dom environment).
import { act, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach } from 'vitest';
import { createMemoryHistory, type RouterHistory } from '@appskord/platform/router';
import { createRouter, type Router } from '../lib/router';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Surface<S extends string> = ReturnType<typeof createRouter<S>>;

const mounted: (() => void)[] = [];
afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); });

/** Renders a surface on a memory history at `href`, the way an entrypoint mounts it. */
export async function mount<S extends string>(surface: Surface<S>, initial: S, href = '/', history?: RouterHistory) {
  const memory = history ?? createMemoryHistory({ initialEntries: [href] });
  const seen: { router?: Router<S> } = {};
  const visited: S[] = [];
  function Probe() {
    seen.router = surface.useRouter();
    if (visited.at(-1) !== seen.router.route.screen) visited.push(seen.router.route.screen);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <surface.RouterProvider initial={{ screen: initial, params: {} }} history={memory}>
        <surface.Outlet />
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
    get router(): Router<S> {
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
