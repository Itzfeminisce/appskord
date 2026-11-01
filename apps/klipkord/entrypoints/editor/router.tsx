import { useMemo } from 'react';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createSurfaceRouter,
  RouterProvider,
  useRouterState,
  type RouterHistory,
} from '@appskord/platform/router';
import { DepsContext, useDeps, type EditorDeps } from './deps';
import { Editor, type EditorSlots } from './Editor';
import { NoProject } from './states/pages';

/** The recording id in `#/<recordingId>`; undefined on a bare editor.html (no-project). */
export function recordingIdOf(pathname: string): string | undefined {
  const raw = pathname.replace(/^\/+/, '').split('/')[0];
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function EditorRoute({ slots }: { slots?: EditorSlots }) {
  const deps = useDeps();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const id = recordingIdOf(pathname);
  // A new recording id is a new editor: nothing from the last one carries over.
  return id ? <Editor key={id} id={id} slots={slots} /> : <NoProject onLibrary={() => deps.openPanel('Library')} />;
}

/** The editor tab's router: `/` is no-project, `/<recordingId>` the editor. */
export function createEditorRouter(slots?: EditorSlots, history: RouterHistory = createHashHistory()) {
  const root = createRootRoute({ component: () => <EditorRoute slots={slots} /> });
  const tree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/' }),
    createRoute({ getParentRoute: () => root, path: '$' }),
  ]);
  return createSurfaceRouter(tree, history);
}

export function EditorApp({ deps, slots, history }: { deps: EditorDeps; slots?: EditorSlots; history?: RouterHistory }) {
  const router = useMemo(() => createEditorRouter(slots, history), [slots, history]);
  return (
    <DepsContext.Provider value={deps}>
      <RouterProvider router={router} />
    </DepsContext.Provider>
  );
}
