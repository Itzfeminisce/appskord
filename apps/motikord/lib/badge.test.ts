import { describe, expect, it } from 'vitest';
import { badgeSender, badgeText, badgeTitle, setBadge, type ActionApi } from './badge';

function fakeAction() {
  const calls: string[] = [];
  const api: ActionApi = {
    setBadgeText: ({ text }) => { calls.push(`text:${text}`); },
    setTitle: ({ title }) => { calls.push(`title:${title}`); },
    setBadgeBackgroundColor: ({ color }) => { calls.push(`bg:${color}`); },
    setBadgeTextColor: ({ color }) => { calls.push(`fg:${color}`); },
  };
  return { api, calls };
}

describe('badge', () => {
  it('shows the Icon frame text and tooltip', () => {
    expect(badgeText(46.7)).toBe('46%');
    expect(badgeTitle(46)).toBe('Motikord · Exporting 46%');
    expect(badgeText(null)).toBe('');
    expect(badgeText(140)).toBe('100%');
  });
  it('sets and clears through chrome.action', async () => {
    const { api, calls } = fakeAction();
    await setBadge(46, api, 'Open Motikord');
    expect(calls).toEqual(['bg:#BE185D', 'fg:#FFFFFF', 'text:46%', 'title:Motikord · Exporting 46%']);
    calls.length = 0;
    await setBadge(null, api, 'Open Motikord');
    expect(calls).toEqual(['text:', 'title:Open Motikord']);
  });
  it('sends once per whole percent', () => {
    const sent: (number | null)[] = [];
    const s = badgeSender((p) => sent.push(p));
    [0, 0.2, 0.9, 1, 1.5, 2, null, null].forEach(s);
    expect(sent).toEqual([0, 1, 2, null]);
  });
});
