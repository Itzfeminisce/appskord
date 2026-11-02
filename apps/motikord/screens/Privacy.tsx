import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { PROVIDERS } from '../lib/providers';
import { getSettings, onSettingsChanged } from '../lib/settings';
import type { Settings } from '../lib/types';
import { BackButton, Page } from './Setup';

export const CODE_URL = 'https://github.com/Itzfeminisce';

/** The extension's version from the manifest. */
export function appVersion(): string {
  try { return browser.runtime.getManifest().version; } catch { return '2.0.0'; }
}

interface Row { what: string; where: string; note?: string; pill?: 'critic' | 'aiImages'; detail: string }

/** One row per kind of data, from the PrivacyV2 frame. */
export function privacyRows(s: Settings): Row[] {
  return [
    { what: 'Prompt, storyboard and recipe text', where: 'Your chosen AI', note: PROVIDERS[s.provider].label, detail: 'What you type, the scene plan and slot text, so the AI can write and fill your clip.' },
    { what: 'Preview frames', where: 'Your chosen AI · visual critic only', note: PROVIDERS[s.provider].label, pill: 'critic', detail: '2 to 4 frames, 512 px. They show your text and any media in the clip.' },
    { what: 'Image description', where: 'Image provider · AI images only', note: 'OpenAI', pill: 'aiImages', detail: 'The slot\'s few words, like “warm sourdough loaf”. Never your media.' },
    { what: 'Music', where: 'Nowhere', note: 'Beat sync is local', detail: 'Beats are found on this computer. The music never leaves it.' },
    { what: 'Templates, style packs, fonts, examples', where: 'Bundled', note: 'Nothing downloaded', detail: 'They come with Motikord and work offline.' },
    { what: 'Your media, editor, renders and library', where: 'This computer', note: 'Stays here', detail: 'Photos, videos, clips and exports are never uploaded.' },
  ];
}

const icon = (paths: ReactNode, size = 14) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
const cloud = icon(<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z" />);
const laptop = icon(<><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></>);
const arrow = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const LEAVES = new Set(['Prompt, storyboard and recipe text', 'Preview frames', 'Image description']);

export function PrivacyView({ s, onSettings }: { s: Settings; onSettings: () => void }) {
  const name = { critic: 'Visual critic', aiImages: 'AI images' };
  return (
    <>
      <p style={{ margin: '12px 24px 0', fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Each kind of data, and the only place it goes. Anything not listed stays on this computer.</p>
      <ul style={{ listStyle: 'none', margin: '16px 16px 0', padding: 0, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', overflow: 'hidden' }}>
        {privacyRows(s).map((r, i) => {
          const on = r.pill ? s[r.pill] : false;
          const leaves = LEAVES.has(r.what);
          const lit = leaves && (!r.pill || on);
          return (
            <li key={r.what} style={{ display: 'flex', gap: 12, padding: 14, borderTop: i ? '1px solid #EFEFF1' : 0 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: !leaves ? '#F0FDF4' : lit ? 'var(--tint)' : '#F1F1F3', color: !leaves ? 'var(--success-ink)' : lit ? 'var(--accent-hover)' : 'var(--muted)' }}>{leaves ? cloud : laptop}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{r.what}</span>
                  {r.pill && (
                    <a href="#settings" onClick={(e) => { e.preventDefault(); onSettings(); }} aria-label={`${name[r.pill]} is ${on ? 'on' : 'off'}. Change in Settings`} style={{ textDecoration: 'none' }}>
                      <span style={{ height: 20, padding: '0 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0, color: on ? 'var(--success-ink)' : 'var(--muted)', background: on ? '#F0FDF4' : '#F1F1F3' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: on ? 'var(--success-ink)' : '#A1A1AA' }} />{on ? 'On' : 'Off'}
                      </span>
                    </a>
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexWrap: 'wrap' }}>
                  {arrow}<span style={{ fontWeight: 500 }}>{r.where}</span>
                  {r.note && <span style={{ height: 20, padding: '0 7px', borderRadius: 999, fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center', background: leaves ? 'var(--tint)' : '#F0FDF4', color: leaves ? 'var(--accent-hover)' : 'var(--success-ink)' }}>{r.note}</span>}
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{r.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div style={{ margin: '16px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{icon(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>)}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Keys</span>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Keys come from Penv Cloud or a key you paste. They're never printed, logged or shared.</span>
        </span>
      </div>
    </>
  );
}

export default function Privacy() {
  const { back, navigate } = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    getSettings().then(setS).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    return onSettingsChanged(setS);
  }, []);
  return (
    <Page frame="Privacy">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '20px 24px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Where your data goes</h1>
      </div>
      {s && <PrivacyView s={s} onSettings={() => navigate('Settings')} />}
      <div style={{ marginTop: 'auto', padding: '24px 16px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <a href={CODE_URL} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>{icon(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />)}Read the code</a>
        <span className="mono" style={{ fontSize: 12, color: 'var(--faint)' }}>Motikord {appVersion()}</span>
      </div>
    </Page>
  );
}
