import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { checkKey, createKeyWatcher, detectKey, serviceLabel, type EnvKeyName } from '../lib/keyDetect';
import { mergeKeys } from '../lib/keys';
import { updateSettings } from '../lib/settings';
import { SourceToggle } from './PenvConnect';
import { Footer, Page, StepHead, Title } from './Setup';
import { GroqAccess, KeyChecking, KeyNotRecognised, KeyRejected } from './StatesSetup';

type Status =
  | { kind: 'empty' }
  | { kind: 'not-recognised' }
  | { kind: 'checking'; name: EnvKeyName }
  | { kind: 'ready'; name: EnvKeyName }
  | { kind: 'rejected'; name: EnvKeyName }
  | { kind: 'blocked'; name: EnvKeyName };

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
  const [busy, setBusy] = useState(false);
  const run = useRef(0);

  /** Asks for host access, then checks the key; the key is saved only when the service accepts it. */
  async function verify(name: EnvKeyName, key: string, mine: number): Promise<Status> {
    // requestHost is called first with nothing awaited before it, so the paste or click gesture counts.
    const access = await requestHost(name === 'GROQ_API_KEY' ? HOSTS.groq : HOSTS.pexels);
    if (mine !== run.current) return { kind: 'empty' };
    if (access === 'denied') return { kind: 'blocked', name };
    const result = await checkKey(name, key);
    if (mine !== run.current) return { kind: 'empty' };
    if (result === 'rejected') return { kind: 'rejected', name };
    if (result === 'unreachable') return { kind: 'blocked', name };
    await mergeKeys({ [name]: key.trim() });
    await updateSettings({ keySource: 'paste' });
    return { kind: 'ready', name };
  }

  function check(name: EnvKeyName, key: string) {
    if (name !== 'GROQ_API_KEY') return setStatus({ kind: 'not-recognised' });
    const mine = ++run.current;
    setStatus({ kind: 'checking', name });
    verify(name, key, mine)
      .then((s) => mine === run.current && setStatus(s))
      .catch((error: unknown) => {
        console.error('Motikord: could not check the key', error);
        if (mine === run.current) setStatus({ kind: 'blocked', name });
      });
  }

  const watcher = useRef(createKeyWatcher((name, key) => check(name, key)));
  useEffect(() => () => watcher.current.cancel(), []);

  function onInput(next: string) {
    setValue(next);
    ++run.current;
    if (!next.trim()) return setStatus({ kind: 'empty' });
    const name = detectKey(next);
    setStatus(name && name !== 'GROQ_API_KEY' ? { kind: 'not-recognised' } : name ? { kind: 'empty' } : { kind: 'not-recognised' });
    watcher.current.type(next);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    e.preventDefault();
    setValue(text);
    const name = detectKey(text);
    if (!name || name !== 'GROQ_API_KEY') { ++run.current; watcher.current.cancel(); return setStatus({ kind: 'not-recognised' }); }
    watcher.current.paste(text);
  }

  async function start() {
    if (status.kind !== 'ready') return;
    setBusy(true);
    try {
      await updateSettings({ onboarded: true });
      replace('Home');
    } catch (error) {
      console.error('Motikord: could not save the key', error);
    } finally {
      setBusy(false);
    }
  }

  const canStart = status.kind === 'ready' && status.name === 'GROQ_API_KEY';
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
            onChange={(e) => onInput(e.target.value)} onPaste={onPaste}
            style={{ height: 44, padding: '0 12px', borderRadius: 10, border: `1px solid ${status.kind === 'rejected' || status.kind === 'not-recognised' ? 'var(--error-line)' : 'var(--line-strong)'}`, background: 'var(--surface)', font: '14px var(--mono)', color: 'var(--ink)' }}
          />
        </label>
        {status.kind === 'checking' && <KeyChecking service={serviceLabel(status.name)} />}
        {status.kind === 'ready' && <Detected name={status.name} ready />}
        {status.kind === 'blocked' && <GroqAccess onAllow={() => check(status.name, value)} />}
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
