// Grab needs the site access of the page you are on. A side-panel click grants no activeTab, so the origin is asked for inside the click.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { grabBlocked } from './pick';

/** The `https://example.com/*` pattern for a page, or undefined when Chrome never lets an extension read it. */
export function originPattern(url: string | undefined): string | undefined {
  if (!url || grabBlocked(url)) return undefined;
  try { return `${new URL(url).origin}/*`; } catch { return undefined; }
}

/** Asks for the page's origin. Call it first in the click handler, with nothing awaited before it, so Chrome still sees the gesture. */
export async function requestPageAccess(url: string | undefined): Promise<'granted' | 'denied' | 'blocked'> {
  const origin = originPattern(url);
  if (!origin) return 'blocked';
  try {
    return (await chrome.permissions.request({ origins: [origin] })) ? 'granted' : 'denied';
  } catch (error) {
    console.error('Motikord: could not ask for access to this page', error);
    return 'denied';
  }
}

/** The active tab's URL, kept current so a click can ask for its origin without awaiting a tab lookup first. */
export function useActiveTabUrl(): MutableRefObject<string | undefined> {
  const url = useRef<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { if (alive) url.current = tab?.url; }, () => undefined);
    };
    const onUpdated = (_id: number, change: { url?: string; status?: string }, tab: { active?: boolean; url?: string }) => { if (tab.active && (change.url || change.status)) url.current = tab.url; };
    refresh();
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.windows?.onFocusChanged?.addListener(refresh);
    return () => {
      alive = false;
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.windows?.onFocusChanged?.removeListener(refresh);
    };
  }, []);
  return url;
}
