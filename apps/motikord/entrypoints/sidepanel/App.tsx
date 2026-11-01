import { useEffect, useRef, useState } from 'react';
import { DevSwitcher } from '../../components/ui';
import { findInterrupted } from '../../lib/exportJob';
import { onMessage, PANEL_GOTO } from '../../lib/messages';
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

/** The editor tab's "Open Settings" (provider-down): show the screen it asked for. */
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

/** Dev builds only: `#/dev/<frame>` for a make screen shows a sample run (MakingCheck opens Making). */
async function devScreen(): Promise<void> {
  if (typeof __MOTIKORD_DEV_TOOLS__ === 'undefined' || !__MOTIKORD_DEV_TOOLS__) return;
  const asked = /^#\/dev\/(\w+)/.exec(location.hash)?.[1];
  if (!asked) return;
  const { devDemo } = await import('./devDemo');
  const screen = devDemo(asked);
  if (screen !== asked) history.replaceState(history.state, '', `#/dev/${screen}`);
}

export default function App() {
  const [first, setFirst] = useState<SidepanelScreen | null>(null);
  useEffect(() => {
    // An export cut off by Chrome closing is offered again before anything else.
    const interrupted = findInterrupted(Date.now()).catch((error: unknown) => {
      console.error('Motikord: could not read the interrupted export', error);
      return [];
    });
    Promise.all([getSettings(), interrupted, devScreen()])
      .then(([s, jobs]) => setFirst(jobs.length > 0 ? 'Recovered' : s.onboarded ? 'Home' : 'Main'))
      .catch((error: unknown) => {
        console.error('Motikord: could not read settings', error);
        setFirst('Main');
      });
  }, []);
  if (!first) return null;
  // `first` is used only when the hash names no screen; a reload keeps the screen in the hash.
  return (
    <RouterProvider initial={{ screen: first, params: {} }}>
      <Outlet />
      <Goto />
      <GoOnRequest />
      <Switcher />
    </RouterProvider>
  );
}
