import { getSettings, updateSettings } from '../settings';

/** Starts building memory from earlier meetings; the background backfill engine listens for the message. */
export async function startBackfill(): Promise<void> {
  const { memory } = await getSettings();
  await updateSettings({ memory: { ...memory, backfill: 'running' } });
  await browser.runtime.sendMessage({ type: 'rekord.backfill.start' }).catch((error) => console.error('Rekord: could not start building memory', error));
}
