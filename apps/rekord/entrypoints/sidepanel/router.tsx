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

export type ScreenName =
  | 'welcome' | 'permissions' | 'connect' | 'start' | 'live' | 'processing'
  | 'summary' | 'speakers' | 'ask' | 'askall' | 'library' | 'transcript' | 'export' | 'settings' | 'error'
  | 'whatsnew' | 'connections' | 'googleConnect' | 'share'
  // v3 setup: 'connect' is the Setup screen, 'settings' is the AI settings, 'settingsMore' is Recording, language and data
  | 'setupCustom' | 'penvConnect' | 'howItWorks' | 'settingsMore'
  | 'nosound' // v3: desktop-app capture hears nothing
  | 'notionConnect' | 'notionPage'
  | 'home' | 'backfill' // v4: Open loops is home
  | 'people' | 'person' | 'personMerge' | 'forget'
  | 'review' | 'reviewEdit'
  | 'redact' | 'ledger'
  | 'promise' | 'promiseDrop' | 'looksDone' | 'nudge' | 'decisions'
  | 'settingsMemory' | 'folder' | 'move' // v4 settings: memory, Rekord folder, moving computers
  | 'followUp' | 'sendTasks' | 'linearConnect' // v4: after the meeting
  | 'brief' | 'agendaEdit'; // v4 before the meeting: brief (or first-meeting brief) and its agenda

/** Route params. `meetingId` for meeting screens; `message` for the error screen. */
export interface RouteParams { meetingId?: string; itemId?: string; message?: string; atMs?: number; endMs?: number; section?: 'transcription' | 'assistant'; personId?: string; otherId?: string; eventId?: string }
export interface Route { screen: ScreenName; params: RouteParams }

export interface Router {
  route: Route;
  /** Go to a screen, pushing the current one onto the back stack. */
  navigate: (screen: ScreenName, params?: RouteParams) => void;
  /** Go to a screen and clear the back stack (e.g. after onboarding). */
  replace: (screen: ScreenName, params?: RouteParams) => void;
  back: () => void;
  canGoBack: boolean;
  /** Whether a screen is registered, so links to screens later tasks add can wait for them. */
  has: (screen: string) => screen is ScreenName;
}

/** How the side panel treats some screens. */
export interface SurfaceOptions {
  /** Screens whose state lives only in memory: a reload on one opens the first screen, as before. */
  fresh?: ScreenName[];
  /** Screens the browser's Back and Forward cannot leave (a live recording). */
  hold?: ScreenName[];
}

// Survives Back and reload in the URL hash (`#/transcript?meeting=…&at=…`); ids, times and app copy only.
const validateSearch = searchParams({ meeting: 'string', item: 'string', at: 'number', end: 'number', message: 'string', section: 'string', person: 'string', other: 'string', event: 'string' });
const toSearch = (p: RouteParams) => ({ meeting: p.meetingId, item: p.itemId, at: p.atMs, end: p.endMs, message: p.message, section: p.section, person: p.personId, other: p.otherId, event: p.eventId });
// Redirects name screens built from data, which TanStack's typed `to` cannot check.
const redirectTo = (route: Route, state?: object) =>
  redirect({ to: `/${route.screen}`, search: toSearch(route.params), replace: true, state } as unknown as Parameters<typeof redirect>[0]);
function toParams(search: Record<string, unknown>): RouteParams {
  const s = validateSearch(search);
  const params: RouteParams = {};
  if (s.meeting) params.meetingId = s.meeting;
  if (s.item) params.itemId = s.item;
  if (s.message) params.message = s.message;
  if (s.at !== undefined) params.atMs = s.at;
  if (s.person) params.personId = s.person;
  if (s.other) params.otherId = s.other;
  if (s.event) params.eventId = s.event;
  if (s.end !== undefined) params.endMs = s.end;
  if (s.section === 'transcription' || s.section === 'assistant') params.section = s.section;
  return params;
}

/** How long a queued back() waits for the router before the next step runs anyway. */
const BACK_TIMEOUT_MS = 300;

const Context = createContext<Router | null>(null);

export function useRouter(): Router {
  const router = useContext(Context);
  if (!router) throw new Error('useRouter must be used inside RouterProvider');
  return router;
}

/** The side panel's router: `#/<screen>` per screen, on hash history. */
export function createRouter(screens: Partial<Record<ScreenName, ComponentType>>, options: SurfaceOptions = {}) {
  const names = Object.keys(screens) as ScreenName[];
  const isScreen = (name: string): name is ScreenName => (names as string[]).includes(name);
  const hold = options.hold ?? [];
  const fresh = options.fresh ?? [];
  const screenOf = (router: AnyRouter) => router.state.location.pathname.slice(1);
  const Children = createContext<ReactNode>(null);

  /** navigate / replace / back, stable per router; steps run in order, so `back(); navigate(x)` pops then pushes. */
  function controls(router: AnyRouter): Pick<Router, 'navigate' | 'replace' | 'back'> {
    let queue: Promise<unknown> = Promise.resolve();
    const run = (step: () => Promise<unknown>) => {
      queue = queue.then(step).catch((error) => console.error('Rekord: could not change screen', error));
    };
    const go = (screen: ScreenName, params: RouteParams, replace: boolean) =>
      run(() => {
        const location = router.state.location;
        return router.navigate({
          to: `/${screen}`,
          search: toSearch(params),
          replace,
          state: replace ? clearBackState(location) : pushState(location),
        });
      });
    const back = () =>
      run(() => {
        if (!canGoBack(router.state.location) || (hold as string[]).includes(screenOf(router))) return Promise.resolve();
        // Resolves on navigation, or after a short wait when a blocker swallows the pop, so the queue never stalls.
        return new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); stop(); resolve(); };
          const stop = router.subscribe('onResolved', done);
          const timer = setTimeout(done, BACK_TIMEOUT_MS);
          router.history.back();
        });
      });
    return {
      navigate: (screen, params = {}) => go(screen, params, false),
      replace: (screen, params = {}) => go(screen, params, true),
      back,
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
      return { ...stable, route: { screen: name, params: toParams(location.search as Record<string, unknown>) }, canGoBack: canGoBack(location), has: isScreen };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, stable, href, index]);
    const holding = value !== null && hold.includes(value.route.screen);
    // Back and Forward stay on a live recording; the screen's own replace still moves on.
    useEffect(() => {
      if (!holding) return;
      return router.history.block({
        blockerFn: ({ action }: { action: string }) => action === 'BACK' || action === 'FORWARD' || action === 'GO',
        enableBeforeUnload: false,
      });
    }, [router, holding]);
    const children = useContext(Children);
    if (!value) return null;
    // Keyed here as before: a new screen or meeting mounts a new screen.
    const Screen = screens[value.route.screen] as ComponentType;
    return (
      <Context.Provider value={value}>
        <Screen key={`${value.route.screen}:${value.route.params.meetingId ?? ''}:${value.route.params.personId ?? ''}`} />
        {children}
      </Context.Provider>
    );
  }

  /** The route tree; an empty or unknown hash opens `initial`. */
  function build(initial: Route, history?: RouterHistory) {
    const root = createRootRoute({ component: Root });
    // True until the first screen has rendered: the load a reload starts.
    let loading = true;
    // The initial screen becomes the back floor, so Back is off there after a reload redirect.
    const start = () => {
      throw redirectTo(initial, clearBackState(router.state.location));
    };
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
    const router: AnyRouter = createSurfaceRouter(root.addChildren(routes), history);
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
