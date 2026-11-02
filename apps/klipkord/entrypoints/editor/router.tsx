import { useEffect, useMemo, useState } from 'react';
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
import { C } from './ui';

const NOTICE_MS = 5000;
let notice: string | null = null;

/** Leaves the project for the no-project page, which shows `text` as a toast (after Delete project). */
export function leaveProject(text: string): void {
  notice = text;
  window.location.hash = '#/';
}

function Notice() {
  const [text, setText] = useState(notice);
  useEffect(() => {
    notice = null;
    const timer = setTimeout(() => setText(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (!text) return null;
  return (
    <div role="status" style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 32, zIndex: 16, padding: '8px 14px', borderRadius: 10, background: C.text, color: C.ground, fontSize: 13, fontWeight: 500, boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>{text}</div>
  );
}

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
  if (id) return <Editor key={id} id={id} slots={slots} />;
  return <><NoProject onLibrary={() => deps.openPanel('Library')} /><Notice /></>;
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
