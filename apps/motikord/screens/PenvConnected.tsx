import { useEffect, useState } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { loadKeys } from '../lib/keys';
import { disconnectPenvApp, restoreKeys } from '../lib/penvApp';
import { getSettings, updateSettings } from '../lib/settings';
import type { Settings } from '../lib/types';
import { connectPenvCloud } from './PenvConnect';
import { Footer, Page, StepHead, Title } from './Setup';
import { PenvNoUsableKeys, PenvNotConnected } from './StatesSetup';

const ROWS = [
  { name: 'GROQ_API_KEY', label: 'Groq', job: 'Writes your clips and makes your changes' },
  { name: 'PEXELS_API_KEY', label: 'Pexels', job: 'Free photos and videos in media search' },
] as const;

function Ready({ ready }: { ready: boolean }) {
  if (!ready) return <span aria-hidden="true" style={{ color: 'var(--faint)' }}>–</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--success-ink)', fontSize: 13, fontWeight: 500 }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Ready
    </span>
  );
}

export default function PenvConnected() {
  const { back, navigate, replace } = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keys, setKeys] = useState<Record<string, string> | null>(null);
  const [retry, setRetry] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setSettings(s);
      await restoreKeys(s.penvApp);
      setKeys(await loadKeys());
    })().catch((error: unknown) => console.error('Motikord: could not read the Penv Cloud keys', error));
  }, []);

  async function change() {
    setBusy(true);
    setRetry(false);
    const ok = await connectPenvCloud();
    setBusy(false);
    if (!ok) return setRetry(true);
    setKeys(await loadKeys());
    setSettings(await getSettings());
  }

  async function disconnect() {
    try {
      await disconnectPenvApp();
      await updateSettings({ keySource: null, penvApp: undefined });
      navigate('PenvConnect');
    } catch (error) {
      console.error('Motikord: could not disconnect Penv Cloud', error);
    }
  }

  async function start() {
    try {
      await updateSettings({ onboarded: true });
      replace('Home');
    } catch (error) {
      console.error('Motikord: could not finish setup', error);
    }
  }

  const conn = settings?.penvApp;
  const hasGroq = !!keys?.GROQ_API_KEY;
  return (
    <Page frame="PenvConnected">
      <StepHead step={2} onBack={back} />
      <Title title="Penv Cloud is connected">Motikord loads these keys each time you open it, and forgets them when Chrome closes.</Title>
      <div style={{ margin: '18px 24px 0', padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="mono" aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 500 }}>pv</span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Penv Cloud</span>
            {conn && <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{conn.org} › {conn.project}</span>}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {ROWS.map((r) => (
            <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--ground)' }}>
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.job}</span>
              </span>
              <Ready ready={!!keys?.[r.name]} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="ghost" busy={busy} busyLabel="Connecting" onClick={() => void change()}>Change which keys</Button>
          <Button variant="danger" onClick={() => void disconnect()}>Disconnect</Button>
        </div>
      </div>
      <div style={{ margin: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {keys && !hasGroq && <PenvNoUsableKeys onPaste={() => navigate('PasteKey')} />}
        {retry && <PenvNotConnected onTryAgain={() => void change()} onPaste={() => navigate('PasteKey')} />}
      </div>
      <Footer><Button block disabled={!hasGroq} onClick={() => void start()}>Start making clips</Button></Footer>
    </Page>
  );
}
