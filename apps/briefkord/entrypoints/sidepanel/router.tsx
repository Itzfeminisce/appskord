import { createRootRoute, createRoute, createSurfaceRouter, Outlet, useRouter, type AnyRouter, type RouterHistory } from '@appskord/platform/router';
import { PanelProvider, usePanel } from './data';
import { Boards } from './screens/Boards';
import { Main } from './screens/Main';
import { NewBoard } from './screens/NewBoard';
import { Saved } from './screens/Saved';
import { Settings } from './settings/Settings';

function Root() {
  const router = useRouter();
  return (
    <PanelProvider onRoute={(intent) => void router.navigate({ to: intent.route, search: intent.search ?? {} } as never)}>
      <Outlet />
    </PanelProvider>
  );
}

/** Home: the first-run screen until a board exists, then Main. */
function Home() {
  const { loaded, boards } = usePanel();
  if (!loaded) return <div className="panel" />;
  return boards.length ? <Main /> : <NewBoard />;
}

export function createAppRouter(history?: RouterHistory): AnyRouter {
  const root = createRootRoute({ component: Root });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: Home });
  const saved = createRoute({
    getParentRoute: () => root,
    path: '/saved/$cardId',
    component: function SavedRoute() {
      const { cardId } = saved.useParams();
      const search = saved.useSearch() as { offline?: string };
      return <Saved cardId={cardId} offline={search.offline === '1'} />;
    },
  });
  const boards = createRoute({ getParentRoute: () => root, path: '/boards', component: Boards });
  const make = createRoute({ getParentRoute: () => root, path: '/new', component: NewBoard });
  const settings = createRoute({
    getParentRoute: () => root,
    path: '/settings',
    component: function SettingsRoute() {
      const search = settings.useSearch() as { show?: string };
      return <Settings show={search.show} />;
    },
  });
  return createSurfaceRouter(root.addChildren([home, saved, boards, make, settings]), history);
}
