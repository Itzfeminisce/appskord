import {
  createHashHistory,
  createRouter,
  type AnyRoute,
  type AnyRouter,
  type HistoryState,
  type RouterHistory,
} from '@tanstack/react-router';

export {
  createHashHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  Outlet,
  redirect,
  RouterProvider,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
export type { AnyRoute, AnyRouter, HistoryState, RouterHistory } from '@tanstack/react-router';

/** Plain `?a=b` search strings: every value stays a string, so an id like `123` is never turned into a number. */
export function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search));
}

export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** One router per surface (side panel, editor tab, recorder tab), on hash history so Back, Forward and reload work. */
export function createSurfaceRouter(routeTree: AnyRoute, history: RouterHistory = createHashHistory()): AnyRouter {
  // Code-based trees built from data are not statically typed, so the options are passed untyped.
  return createRouter({ routeTree, history, parseSearch, stringifySearch } as Parameters<typeof createRouter>[0]);
}

type Kind = 'string' | 'number' | 'boolean';
type Value<K extends Kind> = K extends 'string' ? string : K extends 'number' ? number : boolean;
export type Search<T extends Record<string, Kind>> = { [P in keyof T]?: Value<T[P]> };

/** A typed `validateSearch`: keeps only the named keys, each as its kind; anything else is dropped. Never put a secret in one. */
export function searchParams<T extends Record<string, Kind>>(shape: T): (raw: Record<string, unknown>) => Search<T> {
  return (raw) => {
    const out: Record<string, unknown> = {};
    for (const [key, kind] of Object.entries(shape)) {
      const value = raw[key];
      if (value === undefined || value === null || value === '') continue;
      const text = String(value);
      if (kind === 'string') out[key] = text;
      else if (kind === 'number' && Number.isFinite(Number(text))) out[key] = Number(text);
      else if (kind === 'boolean' && (text === 'true' || text === 'false')) out[key] = text === 'true';
    }
    return out as Search<T>;
  };
}

// A replace that starts a new flow (e.g. after first run) sets a floor, so the app's own Back stops there.
const FLOOR = 'appskordFloor';
type Located = { state: object };
const index = (location: Located): number => Number((location.state as Record<string, unknown>).__TSR_index ?? 0);
const floor = (location: Located): number => Number((location.state as Record<string, unknown>)[FLOOR] ?? 0);

/** True when the app's Back has an earlier screen to return to on this surface. */
export function canGoBack(location: Located): boolean {
  return index(location) > floor(location);
}

/** History state for a push: carries the current floor forward. */
export function pushState(location: Located): HistoryState {
  return { [FLOOR]: floor(location) } as HistoryState;
}

/** History state for a replace that clears the back stack. */
export function clearBackState(location: Located): HistoryState {
  return { [FLOOR]: index(location) } as HistoryState;
}
