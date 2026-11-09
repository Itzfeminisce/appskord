import { useEffect } from 'react';
import { HOME_ROUTE, useRouter } from '../../entrypoints/sidepanel/router';
import { BackButton } from '../../screens/Setup';
import { Button } from '../ui';
import { WHATS_NEW } from './copy';
import { HERO_GLOW, WHATS_NEW_ART } from './whatsNewArt';
import { dismissNewCard, markWhatsNewSeen } from './whatsNew';

/** WhatsNewV3: shown once after the update; seeing it marks the version as seen. */
export default function WhatsNewV3() {
  const { replace } = useRouter();
  useEffect(() => {
    const version = browser.runtime.getManifest().version;
    markWhatsNewSeen(version).then(dismissNewCard).catch((error: unknown) => console.error('Motikord: could not save that you saw what’s new', error));
  }, []);
  return (
    <main data-frame="WhatsNewV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0 20px' }}>
        <BackButton onBack={() => replace(HOME_ROUTE)} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{WHATS_NEW.title}</span>
      </div>
      <header style={{ margin: '10px 16px 0', padding: '20px 18px 18px', borderRadius: 18, background: '#0B0B10', position: 'relative', overflow: 'hidden', boxShadow: '0 16px 34px -18px rgba(11,11,16,0.7)' }}>
        {HERO_GLOW}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.08em', color: '#B4B6C2' }}>{WHATS_NEW.badge}</span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, fontWeight: 600, letterSpacing: '-0.025em', color: '#F5F5F7' }}>{WHATS_NEW.heading}</h1>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: '#B4B6C2' }}>{WHATS_NEW.line}</p>
        </div>
      </header>
      <ol style={{ listStyle: 'none', margin: '12px 16px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {WHATS_NEW.items.map((item, i) => (
          <li key={item.title} style={{ padding: '10px 12px 10px 10px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 14, alignItems: 'center' }}>
            {WHATS_NEW_ART[i]}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{item.title}</h2>
                {'tag' in item && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', background: '#F1F1F4', padding: '2px 7px', borderRadius: 999, whiteSpace: 'nowrap' }}>{item.tag}</span>}
              </span>
              <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{item.line}</p>
            </div>
          </li>
        ))}
      </ol>
      <div style={{ margin: '12px 16px 0', padding: '12px 14px', borderRadius: 12, background: 'var(--tint)', border: '1px solid var(--tint-strong)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" /></svg>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--ink)' }}>{WHATS_NEW.v2}</p>
      </div>
      <div style={{ marginTop: 'auto', padding: 16 }}>
        <Button block onClick={() => replace(HOME_ROUTE)} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>
          {WHATS_NEW.make}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: -3, marginLeft: 8 }}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </Button>
      </div>
    </main>
  );
}
