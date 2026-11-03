import { createRootRoute, createRoute, createSurfaceRouter, Outlet, type AnyRouter, type RouterHistory } from '@appskord/platform/router';
import { useEffect, useState } from 'react';
import { loadBoard } from '@/lib/store/db';
import { onBoardChanged } from '@/lib/store/channel';

// Placeholder until T3 builds the canvas: shows the board's name, kept fresh by the channel.
function BoardScreen({ id }: { id: string }) {
  const [name, setName] = useState<string>();
  useEffect(() => {
    const load = () =>
      loadBoard(id)
        .then((board) => setName(board?.name))
        .catch((error: unknown) => console.error('Briefkord: could not load the board', error));
    void load();
    return onBoardChanged((changed) => changed === id && void load());
  }, [id]);
  return <h1>{name ?? 'Briefkord'}</h1>;
}

export function createAppRouter(history?: RouterHistory): AnyRouter {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: '/', component: () => <h1>Briefkord</h1> });
  const board = createRoute({
    getParentRoute: () => root,
    path: '/b/$id',
    component: function Board() {
      return <BoardScreen id={board.useParams().id} />;
    },
  });
  return createSurfaceRouter(root.addChildren([home, board]), history);
}
