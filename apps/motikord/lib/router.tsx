import { createContext, useCallback, useContext, useMemo, useState, type ComponentType, type ReactNode } from 'react';

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

/** In dev builds, `?screen=<frame name>` opens that screen first. */
export function screenFromUrl<S extends string>(names: readonly S[], search = globalThis.location?.search ?? ''): S | undefined {
  if (!devTools) return undefined;
  const asked = new URLSearchParams(search).get('screen');
  return names.find((n) => n === asked);
}

/** One router per surface (side panel, editor tab), each with its own screen names. */
export function createRouter<S extends string>(screens: Record<S, ComponentType>) {
  const names = Object.keys(screens) as S[];
  const Context = createContext<Router<S> | null>(null);

  function RouterProvider({ initial, children }: { initial: Route<S>; children: ReactNode }) {
    const [stack, setStack] = useState<Route<S>[]>([initial]);
    const navigate = useCallback((screen: S, params: RouteParams = {}) => setStack((s) => [...s, { screen, params }]), []);
    const replace = useCallback((screen: S, params: RouteParams = {}) => setStack([{ screen, params }]), []);
    const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
    const value = useMemo<Router<S>>(
      () => ({ route: stack[stack.length - 1] ?? initial, navigate, replace, back, canGoBack: stack.length > 1 }),
      [stack, initial, navigate, replace, back],
    );
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }

  function useRouter(): Router<S> {
    const router = useContext(Context);
    if (!router) throw new Error('useRouter must be used inside RouterProvider');
    return router;
  }

  /** Renders the current route's screen. */
  function Outlet() {
    const Screen: ComponentType = screens[useRouter().route.screen];
    return <Screen />;
  }

  return { names, RouterProvider, useRouter, Outlet };
}
