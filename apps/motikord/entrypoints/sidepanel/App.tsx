import { useEffect, useState } from 'react';
import { DevSwitcher } from '../../components/ui';
import { screenFromUrl } from '../../lib/router';
import { getSettings } from '../../lib/settings';
import { Outlet, RouterProvider, sidepanel, useRouter, type SidepanelScreen } from './router';

function Switcher() {
  const { route, replace } = useRouter();
  return <DevSwitcher names={sidepanel.names} current={route.screen} go={(s) => replace(s)} />;
}

export default function App() {
  const [first, setFirst] = useState<SidepanelScreen | null>(() => screenFromUrl(sidepanel.names) ?? null);
  useEffect(() => {
    if (first) return;
    getSettings()
      .then((s) => setFirst(s.onboarded ? 'Home' : 'Main'))
      .catch((error: unknown) => {
        console.error('Motikord: could not read settings', error);
        setFirst('Main');
      });
  }, [first]);
  if (!first) return null;
  return (
    <RouterProvider initial={{ screen: first, params: {} }}>
      <Outlet />
      <Switcher />
    </RouterProvider>
  );
}
