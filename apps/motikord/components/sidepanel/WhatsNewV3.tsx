import { useEffect } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { BackButton } from '../../screens/Setup';
import { Button } from '../ui';
import { WHATS_NEW } from './copy';
import { dismissNewCard, markWhatsNewSeen } from './whatsNew';

/** WhatsNewV3: shown once after the update; seeing it marks the version as seen. */
export default function WhatsNewV3() {
  const { back, replace } = useRouter();
  useEffect(() => {
    const version = browser.runtime.getManifest().version;
    markWhatsNewSeen(version).then(dismissNewCard).catch((error: unknown) => console.error('Motikord: could not save that you saw what’s new', error));
  }, []);
  return (
    <main data-frame="WhatsNewV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{WHATS_NEW.title}</h1>
      </div>
      <div style={{ padding: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--accent)' }}>{WHATS_NEW.badge}</span>
        <h2 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>{WHATS_NEW.heading}</h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{WHATS_NEW.line}</p>
      </div>
      <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {WHATS_NEW.items.map((item) => (
          <li key={item.title} style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{item.title}</h3>
              {'tag' in item && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', background: '#F1F1F3', padding: '2px 8px', borderRadius: 999 }}>{item.tag}</span>}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{item.line}</span>
          </li>
        ))}
      </ul>
      <p style={{ margin: '14px 24px 0', fontSize: 12, lineHeight: 1.5, color: 'var(--faint)' }}>{WHATS_NEW.v2}</p>
      <div style={{ marginTop: 'auto', padding: '18px 16px 0' }}>
        <Button block onClick={() => replace('HomeV3')} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>{WHATS_NEW.make}</Button>
      </div>
    </main>
  );
}
