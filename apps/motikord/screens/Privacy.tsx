import { useEffect, useState } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { PROVIDERS } from '../lib/providers';
import { getSettings, onSettingsChanged } from '../lib/settings';
import type { Settings } from '../lib/types';
import { BackButton, Page } from './Setup';

export const CODE_URL = 'https://github.com/Itzfeminisce';

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

export function PrivacyView({ s, onSettings }: { s: Settings; onSettings: () => void }) {
  const name = { critic: 'Visual critic', aiImages: 'AI images' };
  return (
    <>
      <p style={{ margin: '12px 24px 0', fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>Each kind of data, and the only place it goes. Anything not listed stays on this computer.</p>
      <ul style={{ listStyle: 'none', margin: '16px 24px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {privacyRows(s).map((r) => {
          const on = r.pill ? s[r.pill] : false;
          return (
            <li key={r.what} style={{ padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{r.what}</span>
                {r.pill && (
                  <a href="#settings" onClick={(e) => { e.preventDefault(); onSettings(); }} aria-label={`${name[r.pill]} is ${on ? 'on' : 'off'}. Change in Settings`}
                    style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textDecoration: 'none', color: on ? 'var(--accent)' : 'var(--muted)', background: on ? 'var(--tint)' : '#F1F1F3' }}>{on ? 'On' : 'Off'}</a>
                )}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{r.where}</span>
              {r.note && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.note}</span>}
              <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{r.detail}</span>
            </li>
          );
        })}
      </ul>
      <div style={{ margin: '10px 24px 0', padding: '12px 14px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Keys</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Keys come from Penv Cloud or a key you paste. They're never printed, logged or shared.</span>
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
      <div style={{ marginTop: 'auto', padding: '20px 24px 24px', fontSize: 13, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
        <a href={CODE_URL} target="_blank" rel="noreferrer">Read the code</a>
        <span>Motikord 2.0.0</span>
      </div>
    </Page>
  );
}
