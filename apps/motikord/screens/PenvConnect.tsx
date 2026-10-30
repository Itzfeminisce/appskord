import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { loadKeys } from '../lib/keys';
import { connectKeyNames, connectPenvApp, loadPenvAppKeys } from '../lib/penvApp';
import { updateSettings } from '../lib/settings';
import { Footer, hintStyle, Page, StepHead, Title } from './Setup';
import { PenvNotConnected } from './StatesSetup';

/** Opens the Penv Cloud approval window and loads the shared keys. Call from a click. Resolves false when nothing connected. */
export async function connectPenvCloud(): Promise<boolean> {
  try {
    if ((await requestHost(HOSTS.penv)) === 'denied') return false;
    const conn = await connectPenvApp({ keys: connectKeyNames(['GROQ_API_KEY']) });
    await updateSettings({ keySource: 'penv-app', penvApp: conn });
    await loadPenvAppKeys(conn);
    return true;
  } catch (error) {
    console.error('Motikord: could not connect Penv Cloud', error);
    return false;
  }
}

/** "Use Penv Cloud" / "Paste a key". */
export function SourceToggle({ value, onPick }: { value: 'penv' | 'paste'; onPick: (v: 'penv' | 'paste') => void }) {
  const seg = (v: 'penv' | 'paste', text: string) => (
    <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => value !== v && onPick(v)}
      style={{ flex: 1, height: 34, border: 0, borderRadius: 9, font: '500 13px/1 var(--font)', cursor: 'pointer', background: value === v ? 'var(--surface)' : 'transparent', color: value === v ? 'var(--ink)' : 'var(--muted)', boxShadow: value === v ? '0 1px 2px rgba(17,17,20,0.12)' : 'none' }}>
      {text}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Where keys come from" style={{ display: 'flex', padding: 3, borderRadius: 12, background: 'var(--stage)', gap: 2 }}>
      {seg('penv', 'Use Penv Cloud')}
      {seg('paste', 'Paste a key')}
    </div>
  );
}

const LINK = { color: 'var(--accent)' } as const;
const ext = (href: string, text: ReactNode) => <a href={href} target="_blank" rel="noreferrer" style={LINK}>{text}</a>;

export default function PenvConnect() {
  const { back, navigate, replace } = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    loadKeys().then((k) => setHasKey(!!k.GROQ_API_KEY)).catch((error: unknown) => console.error('Motikord: could not read keys', error));
  }, []);

  async function connect() {
    setBusy(true);
    setFailed(false);
    const ok = await connectPenvCloud();
    setBusy(false);
    if (ok) navigate('PenvConnected');
    else setFailed(true);
  }

  async function start() {
    try {
      await updateSettings({ onboarded: true });
      replace('Home');
    } catch (error) {
      console.error('Motikord: could not finish setup', error);
    }
  }

  return (
    <Page frame="PenvConnect">
      <StepHead step={2} onBack={back} />
      <Title title="Add your Groq key">Motikord keeps keys only until Chrome closes, and never shows them again.</Title>
      <div style={{ margin: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SourceToggle value="penv" onPick={() => navigate('PasteKey')} />
        <div style={{ padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span className="mono" aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 500, flexShrink: 0 }}>pv</span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Your keys, in one safe place</span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{ext('https://penv.cloud', 'Penv Cloud')} stores your API keys. Connect once and Motikord loads the ones you choose each time you open it.</span>
          </span>
        </div>
        <Button block busy={busy} busyLabel="Connecting" onClick={() => void connect()}>
          Connect Penv Cloud
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
        </Button>
        {failed && <PenvNotConnected onTryAgain={() => void connect()} onPaste={() => navigate('PasteKey')} />}
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>
          <li>Penv Cloud opens in a new window. Sign in and choose which keys Motikord can read.</li>
          <li>Motikord can only read the keys you choose. It can’t change anything.</li>
          <li>Optional: share a free Pexels key too, for photos and videos in media search.</li>
          <li>Disconnect any time, here or on {ext('https://penv.cloud', 'penv.cloud')}.</li>
        </ul>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>New to Penv Cloud? {ext('https://penv.cloud', 'See how it works')}</span>
      </div>
      <Footer>
        <Button block disabled={!hasKey} onClick={() => void start()}>Start making clips</Button>
        {!hasKey && <span style={hintStyle}>Connect Penv Cloud or paste a key to continue.</span>}
      </Footer>
    </Page>
  );
}
