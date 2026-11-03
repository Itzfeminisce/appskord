import { createRootRoute, createRoute, createSurfaceRouter, Outlet, type AnyRouter, type RouterHistory } from '@appskord/platform/router';

// Placeholder until T2 builds the panel screens.
function Main() {
  return <h1>Briefkord</h1>;
}

export function createAppRouter(history?: RouterHistory): AnyRouter {
  const root = createRootRoute({ component: Outlet });
  const main = createRoute({ getParentRoute: () => root, path: '/', component: Main });
  return createSurfaceRouter(root.addChildren([main]), history);
}
