import { useEffect, useState, type ComponentType } from 'react';
import { getSettings } from '@/lib/settings';
import { Spinner } from './components';
import { createRouter, type Route, type ScreenName } from './router';
import Welcome from './screens/Welcome';
import Permissions from './screens/Permissions';
import Setup from './screens/Setup';
import SetupCustom from './screens/SetupCustom';
import PenvConnect from './screens/PenvConnect';
import HowItWorks from './screens/HowItWorks';
import SettingsAI from './screens/SettingsAI';
import Start from './screens/Start';
import Live from './screens/Live';
import Processing from './screens/Processing';
import Speakers from './screens/Speakers';
import Summary from './screens/Summary';
import Ask from './screens/Ask';
import AskAll from './screens/AskAll';
import Library from './screens/Library';
import Transcript from './screens/Transcript';
import Export from './screens/Export';
import Settings from './screens/Settings';
import ErrorScreen from './screens/Error';
import WhatsNew from './screens/v4/WhatsNew';
import Backfill from './screens/v4/Backfill';
import People from './screens/v4/People';
import Person from './screens/v4/Person';
import PersonMerge from './screens/v4/PersonMerge';
import Forget from './screens/v4/Forget';
import Review from './screens/v4/Review';
import ReviewEdit from './screens/v4/ReviewEdit';
import Redact from './screens/v4/Redact';
import Ledger from './screens/v4/Ledger';
import SettingsMemory from './screens/v4/SettingsMemory';
import Folder from './screens/v4/Folder';
import Move from './screens/v4/Move';
import { flushFolder } from '@/lib/folder';
import { Shell } from './components/v4/Shell';
import Home from './screens/v4/Home';
import PromiseScreen from './screens/v4/Promise';
import LooksDone from './screens/v4/LooksDone';
import Nudge from './screens/v4/Nudge';
import Decisions from './screens/v4/Decisions';
import Connections from './screens/Connections';
import Share from './screens/Share';
import NotionConnect from './screens/NotionConnect';
import NotionPage from './screens/NotionPage';
import GoogleConnect from './screens/GoogleConnect';
import { shouldShowWhatsNew } from '@/lib/whatsNew';
import NoSound from './screens/NoSound';
import Brief from './screens/v4/Brief';
import AgendaEdit from './screens/v4/AgendaEdit';
import { PanelGo, useEventCache } from './components/v4/panelGo';

declare global {
  /** True outside the release zip (wxt.config.ts): dev frame routes are built in. */
  const __REKORD_DEV_FRAMES__: boolean;
}
const devFrames = typeof __REKORD_DEV_FRAMES__ !== 'undefined' && __REKORD_DEV_FRAMES__;
/** A dev frame for a full tab or a notification: drawn on its own, outside the side panel's routes. */
export interface DevPage { page: ComponentType }
const inDevWorld = () => devFrames && (location.hash.startsWith('#/dev/') || !!sessionStorage.getItem('rekord.devFrame'));

export const SCREENS: Record<ScreenName, ComponentType> = {
  welcome: Welcome,
  permissions: Permissions,
  connect: Setup,
  setupCustom: SetupCustom,
  penvConnect: PenvConnect,
  howItWorks: HowItWorks,
  start: Start,
  live: Live,
  processing: Processing,
  summary: Summary,
  speakers: Speakers,
  ask: Ask,
  askall: AskAll,
  library: Library,
  transcript: Transcript,
  export: Export,
  settings: SettingsAI,
  settingsMore: Settings,
  error: ErrorScreen,
  whatsnew: WhatsNew,
  connections: Connections,
  googleConnect: GoogleConnect,
  nosound: NoSound,
  share: Share,
  notionConnect: NotionConnect,
  notionPage: NotionPage,
  home: Home,
  backfill: Backfill,
  people: People,
  person: Person,
  personMerge: PersonMerge,
  forget: Forget,
  review: Review,
  reviewEdit: ReviewEdit,
  redact: Redact,
  ledger: Ledger,
  promise: PromiseScreen,
  looksDone: LooksDone,
  nudge: Nudge,
  decisions: Decisions,
  settingsMemory: SettingsMemory,
  folder: Folder,
  move: Move,
  brief: Brief,
  agendaEdit: AgendaEdit,
};

/** First screen: onboarding until the user has finished it, then Open loops. */
export async function initialRoute(): Promise<Route> {
  try {
    const settings = await getSettings();
    if (settings.onboarded && (await shouldShowWhatsNew(browser.runtime.getManifest().version))) {
      return { screen: 'whatsnew', params: {} };
    }
    return { screen: settings.onboarded ? 'home' : 'welcome', params: {} };
  } catch {
    return { screen: 'error', params: { message: 'Rekord couldn’t load your settings. Try reopening the side panel.' } };
  }
}

/** The side panel's routes. Connect flows keep their return path in memory; Live and No sound keep Back from leaving. */
export const sidepanel = createRouter(SCREENS, { fresh: ['googleConnect', 'notionPage'], hold: ['live', 'nosound'] });
const { RouterProvider } = sidepanel;

/** Dev builds: `#/dev/<Frame>` opens that frame's screen in the sample world; a frame not built yet shows its name. */
async function devRoute(): Promise<Route | DevPage | string | undefined> {
  if (!devFrames) return undefined;
  const dev = await import('./dev/open');
  const name = dev.frameInHash(location.hash);
  if (!name) {
    dev.resumeDevFrame();
    return undefined;
  }
  return (await dev.openDevFrame(name)) ?? name;
}

export default function App() {
  const [initial, setInitial] = useState<Route | DevPage | string | null>(null);
  const [real] = useState(() => !inDevWorld());
  // The background briefs from these cached events; never from a dev frame's sample world.
  useEventCache(real);
  useEffect(() => {
    // Rekord folder writes queue while the panel is closed; they go out each time it opens (never from a dev frame's sample world).
    if (real) void flushFolder();
    void devRoute()
      .catch((error) => console.error('Rekord: could not open the dev frame', error))
      .then(async (dev) => setInitial(dev ?? (await initialRoute())));
  }, []);

  if (!initial) {
    return (
      <main className="screen screen-center">
        <Spinner label="Opening Rekord" />
      </main>
    );
  }
  if (typeof initial === 'object' && 'page' in initial) {
    const Page = initial.page;
    return <Page />;
  }
  if (typeof initial === 'string') {
    return (
      <main className="screen screen-center">
        <h1>{initial}</h1>
      </main>
    );
  }
  return (
    // `initial` is used only when the hash names no screen; a reload keeps the screen in the hash.
    <RouterProvider initial={initial}><PanelGo /></RouterProvider>
  );
}
