import { DevSwitcher } from '../../components/ui';
import { screenFromUrl } from '../../lib/router';
import { editor, Outlet, RouterProvider, useRouter } from './router';

function Switcher() {
  const { route, replace } = useRouter();
  return <DevSwitcher names={editor.names} current={route.screen} go={(s) => replace(s, route.params)} />;
}

export default function App() {
  const url = new URLSearchParams(location.search);
  const clipId = url.get('clip') ?? undefined;
  const first = screenFromUrl(editor.names) ?? 'Editor';
  return (
    <RouterProvider initial={{ screen: first, params: { clipId } }}>
      <div className="editor-surface" style={{ display: 'contents' }}>
        <Outlet />
      </div>
      <Switcher />
    </RouterProvider>
  );
}
