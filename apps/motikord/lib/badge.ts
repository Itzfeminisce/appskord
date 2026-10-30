// Icon frame: while exporting the toolbar icon carries a progress badge and the tooltip "Motikord · Exporting 46%".
export const BADGE_COLOUR = '#BE185D';
export const BADGE_TEXT_COLOUR = '#FFFFFF';

export const badgeText = (percent: number | null) => (percent === null ? '' : `${clampPercent(percent)}%`);
export const badgeTitle = (percent: number) => `Motikord · Exporting ${clampPercent(percent)}%`;
export const clampPercent = (p: number) => Math.max(0, Math.min(100, Math.floor(p)));

/** The parts of chrome.action the badge uses, so tests pass a fake. */
export interface ActionApi {
  setBadgeText(d: { text: string }): Promise<void> | void;
  setTitle(d: { title: string }): Promise<void> | void;
  setBadgeBackgroundColor(d: { color: string }): Promise<void> | void;
  setBadgeTextColor?(d: { color: string }): Promise<void> | void;
}

/** Shows the percent on the toolbar icon; null clears it and puts the manifest's tooltip back. */
export async function setBadge(percent: number | null, action: ActionApi, defaultTitle: string): Promise<void> {
  if (percent === null) {
    await action.setBadgeText({ text: '' });
    await action.setTitle({ title: defaultTitle });
    return;
  }
  await action.setBadgeBackgroundColor({ color: BADGE_COLOUR });
  await action.setBadgeTextColor?.({ color: BADGE_TEXT_COLOUR });
  await action.setBadgeText({ text: badgeText(percent) });
  await action.setTitle({ title: badgeTitle(percent) });
}

/** Sends at most one update per whole percent, so the service worker is not woken for every frame. */
export function badgeSender(send: (percent: number | null) => void): (percent: number | null) => void {
  let last: number | null | undefined;
  return (percent) => {
    const p = percent === null ? null : clampPercent(percent);
    if (p === last) return;
    last = p;
    send(p);
  };
}
