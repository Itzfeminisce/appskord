import { getSettings, updateSettings } from './settings';
import type { Settings } from './types';

export const WHATS_NEW_VERSION = '3.1.0';

const parts = (v: string): number[] => v.split('.').map((n) => parseInt(n, 10) || 0);

/** True when `a` is a lower version than `b`; missing parts count as 0. */
function below(a: string, b: string): boolean {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** Only an update from below 3.1.0 makes What's new due; a new install and a later patch never do. */
export const isWhatsNewDue = (reason: string, previous: string | undefined): boolean =>
  reason === 'update' && !!previous && below(previous, WHATS_NEW_VERSION);

/** Handles onInstalled: marks What's new due for people who had an older version. */
export async function handleInstalled(reason: string, previous: string | undefined): Promise<void> {
  if (isWhatsNewDue(reason, previous)) await updateSettings({ whatsNewDue: WHATS_NEW_VERSION });
}

/** Home shows the card while a version is due and not yet seen. */
export const showWhatsNew = (s: Pick<Settings, 'whatsNewDue' | 'whatsNewSeen'>): boolean =>
  !!s.whatsNewDue && s.whatsNewSeen !== s.whatsNewDue;

/** Got it: saves the due version as seen so the card never returns. */
export async function markWhatsNewSeen(): Promise<void> {
  const { whatsNewDue } = await getSettings();
  if (whatsNewDue) await updateSettings({ whatsNewSeen: whatsNewDue });
}
