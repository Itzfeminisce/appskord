import { createContext, useContext, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  canGoBack,
  clearBackState,
  createRootRoute,
  createRoute,
  createSurfaceRouter,
  Outlet as ScreenOutlet,
  pushState,
  redirect,
  RouterProvider as SurfaceProvider,
  searchParams,
  useRouter as useSurfaceRouter,
  useRouterState,
  type AnyRoute,
  type AnyRouter,
  type RouterHistory,
} from '@appskord/platform/router';

declare global {
  // Set by wxt.config.ts: true in dev and `npm run build`, false in the release zip.
  const __MOTIKORD_DEV_TOOLS__: boolean;
}
export const devTools: boolean = typeof __MOTIKORD_DEV_TOOLS__ !== 'undefined' && __MOTIKORD_DEV_TOOLS__;

/** `clipId` for clip screens; `sceneId` / `layerId` to open the editor on a selection. */
export interface RouteParams { clipId?: string; sceneId?: string; layerId?: string }
export interface Route<S extends string> { screen: S; params: RouteParams }

export interface Router<S extends string> {
  route: Route<S>;
  /** Go to a screen, pushing the current one onto the back stack. */
  navigate: (screen: S, params?: RouteParams) => void;
  /** Go to a screen and clear the back stack (e.g. after first run). */
  replace: (screen: S, params?: RouteParams) => void;
  back: () => void;
  canGoBack: boolean;
}

// Survives Back and reload in the URL hash (`#/Editor?clip=…`); ids only, never a key.
const validateSearch = searchParams({ clip: 'string', scene: 'string', layer: 'string' });
const toSearch = (p: RouteParams) => ({ clip: p.clipId, scene: p.sceneId, layer: p.layerId });
// Redirects name screens built from data, which TanStack's typed `to` cannot check.
const redirectTo = (screen: string, params: RouteParams) =>
  redirect({ to: `/${screen}`, search: toSearch(params), replace: true } as unknown as Parameters<typeof redirect>[0]);
function toParams(search: Record<string, unknown>): RouteParams {
  const s = validateSearch(search);
  const params: RouteParams = {};
  if (s.clip) params.clipId = s.clip;
  if (s.scene) params.sceneId = s.scene;
  if (s.layer) params.layerId = s.layer;
  return params;
}

/** One router per surface (side panel, editor tab), each with its own screen names: `#/<screen>` per FRAMES.md frame. */
export function createRouter<S extends string>(screens: Record<S, ComponentType>) {
  const names = Object.keys(screens) as S[];
  const isScreen = (name: string): name is S => (names as string[]).includes(name);
  const Context = createContext<Router<S> | null>(null);
  const Children = createContext<ReactNode>(null);

  /** navigate / replace / back over a TanStack router; stable per router and reading the location at call time. */
  function controls(router: AnyRouter): Pick<Router<S>, 'navigate' | 'replace' | 'back'> {
    const go = (screen: S, params: RouteParams, replace: boolean) => {
      const location = router.state.location;
      void router.navigate({
        to: `/${screen}`,
        search: toSearch(params),
        replace,
        state: replace ? clearBackState(location) : pushState(location),
      });
    };
    return {
      navigate: (screen, params = {}) => go(screen, params, false),
      replace: (screen, params = {}) => go(screen, params, true),
      back: () => { if (canGoBack(router.state.location)) router.history.back(); },
    };
  }

  function Root() {
    const router = useSurfaceRouter();
    const href = useRouterState({ select: (s) => s.location.href });
    const index = useRouterState({ select: (s) => (s.location.state as { __TSR_index?: number }).__TSR_index });
    const stable = useMemo(() => controls(router), [router]);
    // Rebuilt when the location changes, so screens re-render as they did on a stack change.
    const value = useMemo((): Router<S> => {
      const location = router.state.location;
      const name = location.pathname.slice(1);
      return {
        ...stable,
        route: { screen: (isScreen(name) ? name : names[0]) as S, params: toParams(location.search as Record<string, unknown>) },
        canGoBack: canGoBack(location),
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, stable, href, index]);
    const children = useContext(Children);
    if (!isScreen(router.state.location.pathname.slice(1))) return null;
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  /** The route tree for one surface; an empty or unknown hash opens `initial`. */
  function build(initial: Route<S>, history?: RouterHistory) {
    const root = createRootRoute({ component: Root });
    const start = () => {
      throw redirectTo(initial.screen, initial.params);
    };
    const routes: AnyRoute[] = [
      createRoute({ getParentRoute: () => root, path: '/', beforeLoad: start }),
      createRoute({ getParentRoute: () => root, path: '$', beforeLoad: start }),
      ...names.map((name) => {
        const Screen: ComponentType = screens[name];
        return createRoute({ getParentRoute: () => root, path: `/${name}`, validateSearch, component: () => <Screen /> });
      }),
    ];
    // Dev builds only: `#/dev/<frame name>` opens that screen; the release zip has no such route.
    if (devTools) {
      routes.push(
        createRoute({
          getParentRoute: () => root,
          path: '/dev/$screen',
          beforeLoad: ({ params }) => {
            const asked = (params as { screen: string }).screen;
            throw redirectTo(isScreen(asked) ? asked : initial.screen, initial.params);
          },
        }),
      );
    }
    return createSurfaceRouter(root.addChildren(routes), history);
  }

  function RouterProvider({ initial, history, children }: { initial: Route<S>; history?: RouterHistory; children: ReactNode }) {
    const [router] = useState(() => build(initial, history));
    return (
      <Children.Provider value={children}>
        <SurfaceProvider router={router} />
      </Children.Provider>
    );
  }

  function useRouter(): Router<S> {
    const router = useContext(Context);
    if (!router) throw new Error('useRouter must be used inside RouterProvider');
    return router;
  }

  /** Renders the current route's screen. */
  function Outlet() {
    return <ScreenOutlet />;
  }

  return { names, RouterProvider, useRouter, Outlet };
}
