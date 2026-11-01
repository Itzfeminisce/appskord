import { createContext, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  canGoBack,
  clearBackState,
  createRootRoute,
  createRoute,
  createSurfaceRouter,
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

/** One screen per FRAMES.md frame, named as the frame. */
export type ScreenName =
  | 'Main'
  | 'Permissions'
  | 'Setup'
  | 'ModelDownload'
  | 'PenvConnect'
  | 'PasteKey'
  | 'PenvConnected'
  | 'Home'
  | 'Countdown'
  | 'Recording'
  | 'Paused'
  | 'Processing'
  | 'Review'
  | 'ReviewTranscript'
  | 'ReviewComments'
  | 'ReviewAsk'
  | 'NoteStyle'
  | 'Trim'
  | 'EditTranscript'
  | 'Cleanup'
  | 'Export'
  | 'GifClip'
  | 'DriveLink'
  | 'Saved'
  | 'Library'
  | 'LibraryEmpty'
  | 'LibrarySearch'
  | 'Storage'
  | 'Settings'
  | 'Recovered'
  | 'Offline';

/** `recordingId` for recording screens; `atMs` to open the player at a time. */
export interface RouteParams { recordingId?: string; atMs?: number }
export interface Route { screen: ScreenName; params: RouteParams }

export interface Router {
  route: Route;
  /** Go to a screen, pushing the current one onto the back stack. */
  navigate: (screen: ScreenName, params?: RouteParams) => void;
  /** Go to a screen and clear the back stack (e.g. after first run). */
  replace: (screen: ScreenName, params?: RouteParams) => void;
  back: () => void;
  canGoBack: boolean;
}

/** How a surface treats some screens. */
export interface SurfaceOptions {
  /** The React key of a route's screen; routes with the same key keep one mounted screen (the Review tabs). */
  key?: (route: Route) => string;
  /** Screens whose state lives only in memory: a reload on one opens the surface's first screen, as before. */
  fresh?: ScreenName[];
  /** Screens the browser's Back and Forward cannot leave (a live recording), as before. */
  hold?: ScreenName[];
}

// Survives Back and reload in the URL hash (`#/Review?recording=…&at=…`); ids and times only, never a key.
const validateSearch = searchParams({ recording: 'string', at: 'number' });
const toSearch = (p: RouteParams) => ({ recording: p.recordingId, at: p.atMs });
// Redirects name screens built from data, which TanStack's typed `to` cannot check.
const redirectTo = (route: Route) =>
  redirect({ to: `/${route.screen}`, search: toSearch(route.params), replace: true } as unknown as Parameters<typeof redirect>[0]);
function toParams(search: Record<string, unknown>): RouteParams {
  const s = validateSearch(search);
  const params: RouteParams = {};
  if (s.recording) params.recordingId = s.recording;
  if (s.at !== undefined) params.atMs = s.at;
  return params;
}

// Shared by every Klipkord surface, so the player window and the side panel use the same screens.
const Context = createContext<Router | null>(null);

export function useRouter(): Router {
  const router = useContext(Context);
  if (!router) throw new Error('useRouter must be used inside RouterProvider');
  return router;
}

/** One router per surface (side panel, player window): `#/<screen>` per FRAMES.md frame. */
export function createRouter(screens: Partial<Record<ScreenName, ComponentType>>, options: SurfaceOptions = {}) {
  const names = Object.keys(screens) as ScreenName[];
  const isScreen = (name: string): name is ScreenName => (names as string[]).includes(name);
  const keyOf = options.key ?? ((route: Route) => `${route.screen}:${route.params.recordingId ?? ''}`);
  const Children = createContext<ReactNode>(null);

  /** navigate / replace / back over a TanStack router; stable per router and reading the location at call time. */
  function controls(router: AnyRouter): Pick<Router, 'navigate' | 'replace' | 'back'> {
    const go = (screen: ScreenName, params: RouteParams, replace: boolean) => {
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
    const value = useMemo((): Router | null => {
      const location = router.state.location;
      const name = location.pathname.slice(1);
      if (!isScreen(name)) return null;
      return { ...stable, route: { screen: name, params: toParams(location.search as Record<string, unknown>) }, canGoBack: canGoBack(location) };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, stable, href, index]);
    const hold = options.hold ?? [];
    const holding = value !== null && hold.includes(value.route.screen);
    // Back and Forward stay on a live recording screen; the screens' own replace still moves on.
    useEffect(() => {
      if (!holding) return;
      return router.history.block({
        blockerFn: ({ action }: { action: string }) => action === 'BACK' || action === 'FORWARD' || action === 'GO',
        enableBeforeUnload: false,
      });
    }, [router, holding]);
    const children = useContext(Children);
    if (!value) return null;
    // The screen is keyed here, not per route, so the Review tabs share one mounted player as before.
    const Screen = screens[value.route.screen] as ComponentType;
    return (
      <Context.Provider value={value}>
        <Screen key={keyOf(value.route)} />
        {children}
      </Context.Provider>
    );
  }

  /** The route tree for one surface; an empty or unknown hash opens `initial`. */
  function build(initial: Route, history?: RouterHistory) {
    const root = createRootRoute({ component: Root });
    // True until the first screen has rendered: the load a reload starts.
    let loading = true;
    const start = () => {
      throw redirectTo(initial);
    };
    const fresh = options.fresh ?? [];
    const routes: AnyRoute[] = [
      createRoute({ getParentRoute: () => root, path: '/', beforeLoad: start }),
      createRoute({ getParentRoute: () => root, path: '$', beforeLoad: start }),
      ...names.map((name) =>
        createRoute({
          getParentRoute: () => root,
          path: `/${name}`,
          validateSearch,
          beforeLoad: fresh.includes(name) ? () => { if (loading && initial.screen !== name) start(); } : undefined,
        }),
      ),
    ];
    const router = createSurfaceRouter(root.addChildren(routes), history);
    const stop = router.subscribe('onResolved', () => { loading = false; stop(); });
    return router;
  }

  function RouterProvider({ initial, history, children }: { initial: Route; history?: RouterHistory; children?: ReactNode }) {
    const [router] = useState(() => build(initial, history));
    return (
      <Children.Provider value={children}>
        <SurfaceProvider router={router} />
      </Children.Provider>
    );
  }

  return { names, RouterProvider };
}
