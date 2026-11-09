// "What's new" shows once after an update. Same rule as Rekord's: a new install records its version as seen, a patch
// bump is a fix and skips it, a minor or major bump shows it. Kept here, in the panel's own storage keys, because
// Motikord's settings and background carry no update hook yet.
const SEEN = 'motikordWhatsNewSeen';
const CARD = 'motikordV3CardDismissed';

const parts = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);

/** Compares dotted versions numerically: -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when both versions share major and minor, so they differ at most in the patch. */
export function sameMinor(a: string, b: string): boolean {
  const [pa, pb] = [parts(a), parts(b)];
  return (pa[0] ?? 0) === (pb[0] ?? 0) && (pa[1] ?? 0) === (pb[1] ?? 0);
}

async function read<T>(key: string): Promise<T | undefined> {
  return ((await browser.storage.local.get(key)) as Record<string, T | undefined>)[key];
}

/** Marks the current version as seen so What's new does not show again. */
export async function markWhatsNewSeen(current: string): Promise<void> {
  await browser.storage.local.set({ [SEEN]: current });
}

/** Whether the panel should open on What's new now. Records the version when it should not. */
export async function shouldShowWhatsNew(current: string, onboarded: boolean): Promise<boolean> {
  const seen = await read<string>(SEEN);
  if (!onboarded) {
    if (seen !== current) await markWhatsNewSeen(current);
    return false;
  }
  if (seen === undefined) return true;
  if (compareVersions(current, seen) <= 0) return false;
  if (sameMinor(current, seen)) {
    await markWhatsNewSeen(current);
    return false;
  }
  return true;
}

/** Whether Home still shows the "New in Motikord 3" card: until it is dismissed or What's new has been read. */
export async function newCardShown(): Promise<boolean> {
  return !(await read<boolean>(CARD));
}

export async function dismissNewCard(): Promise<void> {
  await browser.storage.local.set({ [CARD]: true });
}
