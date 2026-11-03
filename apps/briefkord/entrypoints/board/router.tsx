import { createRootRoute, createRoute, createSurfaceRouter, Outlet, redirect, searchParams, type AnyRouter, type RouterHistory } from '@appskord/platform/router';
import { AllBoards } from './screens/AllBoards';
import { BoardScreen } from './screens/BoardScreen';
import { ImportScreen } from './share/ImportScreen';

export function createAppRouter(history?: RouterHistory): AnyRouter {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: '/', beforeLoad: () => { throw redirect({ to: '/boards' } as never); } });
  const boards = createRoute({ getParentRoute: () => root, path: '/boards', component: AllBoards });
  const importing = createRoute({ getParentRoute: () => root, path: '/import', component: ImportScreen });
  const board = createRoute({
    getParentRoute: () => root,
    path: '/b/$id',
    validateSearch: searchParams({ card: 'string', view: 'string', summarize: 'string' }),
    component: function Board() {
      const { id } = board.useParams();
      const search = board.useSearch();
      return <BoardScreen id={id} card={search.card} view={search.view === 'list' ? 'list' : 'canvas'} summarize={search.summarize === '1'} />;
    },
  });
  return createSurfaceRouter(root.addChildren([home, boards, importing, board]), history);
}
