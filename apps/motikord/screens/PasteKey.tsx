import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { checkKey, detectKey, serviceLabel, type EnvKeyName } from '../lib/keyDetect';
import { loadKeys, mergeKeys } from '../lib/keys';
import { updateSettings } from '../lib/settings';
import { SourceToggle } from './PenvConnect';
import { Footer, Page, StepHead, Title } from './Setup';
import { KeyChecking, KeyNotRecognised, KeyRejected } from './StatesSetup';

type Status =
  | { kind: 'empty' }
  | { kind: 'not-recognised' }
  | { kind: 'checking'; name: EnvKeyName }
  | { kind: 'ready'; name: EnvKeyName }
  | { kind: 'rejected'; name: EnvKeyName }
  | { kind: 'unverified'; name: EnvKeyName };

const WHAT: Record<EnvKeyName, string | null> = {
  GROQ_API_KEY: 'It writes your clips and makes the changes you ask for.',
  PEXELS_API_KEY: null,
};

function Detected({ name, ready }: { name: EnvKeyName; ready: boolean }) {
  return (
    <div role="status" style={{ padding: '12px 14px', borderRadius: 14, background: ready ? 'var(--success-bg)' : 'var(--surface)', border: `1px solid ${ready ? 'var(--success-line)' : 'var(--line)'}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ready ? 'var(--success-ink)' : 'var(--accent)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>This is a {serviceLabel(name)} key{ready ? ' · Ready' : ''}</span>
        {WHAT[name] && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{WHAT[name]}</span>}
      </span>
    </div>
  );
}

export default function PasteKey() {
  const { back, navigate, replace } = useRouter();
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'empty' });
  const [hasGroq, setHasGroq] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    loadKeys().then((k) => setHasGroq(!!k.GROQ_API_KEY)).catch((error: unknown) => console.error('Motikord: could not read keys', error));
  }, []);

  /** Checks the key with its service and keeps it in session memory when accepted. */
  async function verify(name: EnvKeyName, key: string, mine: number): Promise<Status> {
    const result = await checkKey(name, key);
    if (mine !== run.current) return { kind: 'empty' };
    if (result === 'rejected') return { kind: 'rejected', name };
    if (result === 'ready') {
      await mergeKeys({ [name]: key.trim() });
      if (name === 'GROQ_API_KEY') setHasGroq(true);
      await updateSettings({ keySource: 'paste' });
      return { kind: 'ready', name };
    }
    return { kind: 'unverified', name };
  }

  function onInput(next: string) {
    setValue(next);
    const mine = ++run.current;
    if (!next.trim()) return setStatus({ kind: 'empty' });
    const name = detectKey(next);
    if (!name) return setStatus({ kind: 'not-recognised' });
    setStatus({ kind: 'checking', name });
    verify(name, next, mine)
      .then((s) => mine === run.current && setStatus(s))
      .catch((error: unknown) => {
        console.error('Motikord: could not check the key', error);
        if (mine === run.current) setStatus({ kind: 'unverified', name });
      });
  }

  async function start() {
    setBusy(true);
    try {
      if (status.kind === 'unverified') {
        // Chrome only shows its prompt from a click, so the check that could not run on input runs here.
        const hosts = status.name === 'GROQ_API_KEY' ? HOSTS.groq : HOSTS.pexels;
        await requestHost(hosts);
        const next = await verify(status.name, value, run.current);
        if (next.kind === 'rejected') return setStatus(next);
        if (next.kind === 'unverified') {
          await mergeKeys({ [status.name]: value.trim() });
          await updateSettings({ keySource: 'paste' });
          if (status.name === 'GROQ_API_KEY') setHasGroq(true);
        }
      }
      if (!(await loadKeys()).GROQ_API_KEY) return;
      await updateSettings({ onboarded: true });
      replace('Home');
    } catch (error) {
      console.error('Motikord: could not save the key', error);
    } finally {
      setBusy(false);
    }
  }

  const canStart = status.kind !== 'checking' && status.kind !== 'rejected' && (hasGroq || (status.kind === 'unverified' && status.name === 'GROQ_API_KEY'));
  return (
    <Page frame="PasteKey">
      <StepHead step={2} onBack={back} />
      <Title title="Add your Groq key">Motikord keeps keys only until Chrome closes, and never shows them again.</Title>
      <div style={{ margin: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SourceToggle value="paste" onPick={() => navigate('PenvConnect')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Your key</span>
          <input
            type="password" value={value} autoComplete="off" spellCheck={false} aria-label="Your key"
            onChange={(e) => onInput(e.target.value)}
            style={{ height: 44, padding: '0 12px', borderRadius: 10, border: `1px solid ${status.kind === 'rejected' || status.kind === 'not-recognised' ? 'var(--error-line)' : 'var(--line-strong)'}`, background: 'var(--surface)', font: '14px var(--mono)', color: 'var(--ink)' }}
          />
        </label>
        {status.kind === 'checking' && <KeyChecking service={serviceLabel(status.name)} />}
        {(status.kind === 'ready' || status.kind === 'unverified') && <Detected name={status.name} ready={status.kind === 'ready'} />}
        {status.kind === 'not-recognised' && <KeyNotRecognised />}
        {status.kind === 'rejected' && <KeyRejected />}
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>No key yet? <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free Groq key</a></span>
      </div>
      <div style={{ margin: '18px 24px 0', padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Optional: a Pexels key</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Adds free photos and videos from Pexels to media search. Add it any time in Settings. Openverse needs no key.</span>
        <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>Get a free Pexels key</a>
      </div>
      <Footer>
        <Button block busy={busy} disabled={!canStart} onClick={() => void start()}>Start making clips</Button>
      </Footer>
    </Page>
  );
}
