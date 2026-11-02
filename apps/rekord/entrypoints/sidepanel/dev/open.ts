// Dev builds only (App loads this behind __REKORD_DEV_FRAMES__): seeds the sample world into a scratch DB.
import { getDB } from '@/lib/db';
import { SAMPLE_AFTER, SAMPLE_EVENT, SAMPLE_NOW, seedSample } from '@/lib/memory/sample';
import { BACKFILL_KEY } from '@/lib/memory/backfill';
import { world } from '../components/v4/world';
import type { Route } from '../router';
import type { DevPage } from '../App';
import { DEV_FRAMES } from './frames';

const SCRATCH_DB = 'rekord-dev-frames';
const SESSION_KEY = 'rekord.devFrame';
const SNAPSHOT_KEY = 'rekord.devFrame.storage';
// Every chrome.storage.local key the frames write; restored when the dev world is left.
const TOUCHED_KEYS = ['settings', BACKFILL_KEY, 'whatsNewPending'];

/** The frame named by `#/dev/<Frame>`, if any. */
export function frameInHash(hash: string): string | undefined {
  return /^#\/dev\/([\w-]+)/.exec(hash)?.[1];
}

/** Every later open of the app DB opens the scratch DB instead, so real meetings are never touched. */
function redirectToScratchDB() {
  if (restoreDB) return;
  const original = indexedDB.open;
  const open = original.bind(indexedDB);
  indexedDB.open = ((name: string, version?: number) => open(name === 'rekord' ? SCRATCH_DB : name, version)) as typeof indexedDB.open;
  restoreDB = () => { indexedDB.open = original; restoreDB = undefined; };
  window.addEventListener('hashchange', leaveWhenEmpty);
}

let restoreDB: (() => void) | undefined;

/** An empty hash is the real app again: put the real DB and profile back. */
function leaveWhenEmpty() {
  if (location.hash.replace(/^#\/?/, '')) return;
  window.removeEventListener('hashchange', leaveWhenEmpty);
  restoreDB?.();
  sessionStorage.removeItem(SESSION_KEY);
  void restoreStorage();
}

/** Remembers the developer's own values before the first frame writes over them. */
async function snapshotStorage() {
  if (sessionStorage.getItem(SNAPSHOT_KEY)) return;
  const saved = await browser.storage.local.get(TOUCHED_KEYS);
  sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(saved));
}

async function restoreStorage() {
  const raw = sessionStorage.getItem(SNAPSHOT_KEY);
  if (!raw) return;
  sessionStorage.removeItem(SNAPSHOT_KEY);
  const saved = JSON.parse(raw) as Record<string, unknown>;
  await browser.storage.local.remove(TOUCHED_KEYS.filter((k) => !(k in saved)));
  await browser.storage.local.set(saved);
}

function enterSampleWorld(moment: 'before' | 'after', now?: number) {
  world.now = () => now ?? (moment === 'after' ? SAMPLE_AFTER : SAMPLE_NOW);
  world.events = [SAMPLE_EVENT];
}

const deleted = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(SCRATCH_DB);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => resolve();
});

/** Seeds a fresh scratch DB and returns the frame's route; undefined for a frame not built yet. */
export async function openDevFrame(name: string): Promise<Route | DevPage | undefined> {
  const frame = DEV_FRAMES[name];
  if (!frame) return undefined;
  const moment = frame.moment ?? 'before';
  await deleted();
  await snapshotStorage();
  redirectToScratchDB();
  enterSampleWorld(moment, frame.now);
  const db = await getDB();
  await seedSample({ put: (store, value) => db.put(store as never, value as never) }, moment);
  await frame.setup?.();
  sessionStorage.setItem(SESSION_KEY, name);
  if (frame.page) return { page: await frame.page() };
  return { screen: frame.screen, params: frame.params ?? {} };
}

/** A reload after a frame route stays in its scratch world. */
export function resumeDevFrame(): boolean {
  const frame = DEV_FRAMES[sessionStorage.getItem(SESSION_KEY) ?? ''];
  if (!frame) return false;
  if (!location.hash.replace(/^#\/?/, '')) {
    sessionStorage.removeItem(SESSION_KEY);
    void restoreStorage();
    return false;
  }
  redirectToScratchDB();
  enterSampleWorld(frame.moment ?? 'before', frame.now);
  return true;
}
