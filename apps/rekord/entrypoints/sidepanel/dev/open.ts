// Dev builds only (App loads this behind __REKORD_DEV_FRAMES__): seeds the sample world into a scratch DB.
import { getDB } from '@/lib/db';
import { SAMPLE_AFTER, SAMPLE_EVENT, SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { world } from '../components/v4/world';
import type { Route } from '../router';
import { DEV_FRAMES } from './frames';

const SCRATCH_DB = 'rekord-dev-frames';
const SESSION_KEY = 'rekord.devFrame';

/** The frame named by `#/dev/<Frame>`, if any. */
export function frameInHash(hash: string): string | undefined {
  return /^#\/dev\/([\w-]+)/.exec(hash)?.[1];
}

/** Every later open of the app DB opens the scratch DB instead, so real meetings are never touched. */
function redirectToScratchDB() {
  const open = indexedDB.open.bind(indexedDB);
  indexedDB.open = ((name: string, version?: number) => open(name === 'rekord' ? SCRATCH_DB : name, version)) as typeof indexedDB.open;
}

function enterSampleWorld(moment: 'before' | 'after') {
  world.now = () => (moment === 'after' ? SAMPLE_AFTER : SAMPLE_NOW);
  world.events = [SAMPLE_EVENT];
}

const deleted = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(SCRATCH_DB);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => resolve();
});

/** Seeds a fresh scratch DB and returns the frame's route; undefined for a frame not built yet. */
export async function openDevFrame(name: string): Promise<Route | undefined> {
  const frame = DEV_FRAMES[name];
  if (!frame) return undefined;
  const moment = frame.moment ?? 'before';
  await deleted();
  redirectToScratchDB();
  enterSampleWorld(moment);
  const db = await getDB();
  await seedSample({ put: (store, value) => db.put(store as never, value as never) }, moment);
  await frame.setup?.();
  sessionStorage.setItem(SESSION_KEY, name);
  return { screen: frame.screen, params: frame.params ?? {} };
}

/** A reload after a frame route stays in its scratch world. */
export function resumeDevFrame(): boolean {
  const frame = DEV_FRAMES[sessionStorage.getItem(SESSION_KEY) ?? ''];
  if (!frame) return false;
  redirectToScratchDB();
  enterSampleWorld(frame.moment ?? 'before');
  return true;
}
