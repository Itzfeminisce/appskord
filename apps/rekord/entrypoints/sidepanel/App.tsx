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
import { Shell } from './components/v4/Shell';
import Connections from './screens/Connections';
import Share from './screens/Share';
import NotionConnect from './screens/NotionConnect';
import NotionPage from './screens/NotionPage';
import GoogleConnect from './screens/GoogleConnect';
import { shouldShowWhatsNew } from '@/lib/whatsNew';
import NoSound from './screens/NoSound';

declare global {
  /** True outside the release zip (wxt.config.ts): dev frame routes are built in. */
  const __REKORD_DEV_FRAMES__: boolean;
}
const devFrames = typeof __REKORD_DEV_FRAMES__ !== 'undefined' && __REKORD_DEV_FRAMES__;

// Open loops' body arrives with its own task; the shell is the home screen meanwhile.
const Home = () => <Shell tab="loops" />;

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
async function devRoute(): Promise<Route | string | undefined> {
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
  const [initial, setInitial] = useState<Route | string | null>(null);
  useEffect(() => {
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
  if (typeof initial === 'string') {
    return (
      <main className="screen screen-center">
        <h1>{initial}</h1>
      </main>
    );
  }
  return (
    // `initial` is used only when the hash names no screen; a reload keeps the screen in the hash.
    <RouterProvider initial={initial} />
  );
}
