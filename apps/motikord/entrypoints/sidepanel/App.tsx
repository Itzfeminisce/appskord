import { useEffect, useRef, useState } from 'react';
import { DevSwitcher } from '../../components/ui';
import { onMessage, PANEL_GOTO } from '../../lib/messages';
import { screenFromUrl } from '../../lib/router';
import { getSettings } from '../../lib/settings';
import { takeSidePanelGoal } from '../../lib/sidepanelGo';
import { Outlet, RouterProvider, sidepanel, useRouter, type SidepanelScreen } from './router';

function Switcher() {
  const { route, replace } = useRouter();
  return <DevSwitcher names={sidepanel.names} current={route.screen} go={(s) => replace(s)} />;
}

/** Shows PasteKey when the editor asks, whether the panel was open already or is just starting. */
function Goto() {
  const { navigate } = useRouter();
  useEffect(() => {
    void browser.storage.session.get(PANEL_GOTO).then((v) => {
      if (v[PANEL_GOTO] !== 'PasteKey') return;
      void browser.storage.session.remove(PANEL_GOTO);
      navigate('PasteKey');
    }).catch(() => undefined);
    return onMessage({ 'panel/show-paste-key': () => { void browser.storage.session.remove(PANEL_GOTO).catch(() => undefined); navigate('PasteKey'); } });
    // Subscribes once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** The editor tab's "Open Settings" (groq-down): show the screen it asked for. */
function GoOnRequest() {
  const { route, navigate } = useRouter();
  const at = useRef(route.screen);
  at.current = route.screen;
  useEffect(() => {
    const go = (screen: SidepanelScreen) => { if (at.current !== screen) navigate(screen); };
    void takeSidePanelGoal().then((s) => { if (s) go(s); });
    return onMessage({
      'sidepanel/go': async ({ screen }) => {
        await takeSidePanelGoal();
        go(screen);
        return { shown: true };
      },
    });
  }, [navigate]);
  return null;
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
      <Goto />
      <GoOnRequest />
      <Switcher />
    </RouterProvider>
  );
}
