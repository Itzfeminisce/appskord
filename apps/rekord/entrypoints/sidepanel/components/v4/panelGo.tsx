import { useEffect } from 'react';
import { CACHE_REFRESH_MS, PANEL_ROUTE_KEY, refreshEventCache, takePanelRoute, type PanelRoute } from '@/lib/reminders';
import { useRouter, type RouteParams } from '../../router';

/** Opens the screen a notification or a Rekord tab asked for (brief, nudge, start), now and whenever another arrives. */
export function PanelGo() {
  const { navigate, has } = useRouter();
  useEffect(() => {
    const go = (route: PanelRoute | undefined) => {
      if (!route) return;
      const screen = has(route.screen) ? route.screen : 'start';
      navigate(screen, route.params as RouteParams);
    };
    const take = () => takePanelRoute().then(go).catch((error) => console.error('Rekord: could not open the asked screen', error));
    void take();
    const onChange = (changes: Record<string, unknown>, area: string) => { if (area === 'session' && PANEL_ROUTE_KEY in changes) void take(); };
    browser.storage.onChanged.addListener(onChange);
    return () => browser.storage.onChanged.removeListener(onChange);
  }, [navigate, has]);
  return null;
}

/** While the panel is open, keeps the next 24 hours of calendar events for the background's briefs. */
export function useEventCache(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const refresh = () => { refreshEventCache().catch((error) => console.error('Rekord: could not keep calendar events', error)); };
    refresh();
    const timer = setInterval(refresh, CACHE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [on]);
}
