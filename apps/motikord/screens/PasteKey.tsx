import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { PROVIDERS, providerForKey } from '../lib/providers';
import type { Provider } from '../lib/types';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { createKeyWatcher, detectKey, serviceLabel, verifyKey, type EnvKeyName, type KeyField } from '../lib/keyDetect';
import { mergeKeys } from '../lib/keys';
import { getSettings, updateSettings } from '../lib/settings';
import { SourceToggle } from './PenvConnect';
import { Footer, Page, StepHead, Title } from './Setup';
import { KeyChecking, KeyCheckUnreachable, KeyNotRecognised, KeyRejected, KeyWrongProvider, PexelsKeyRejected, ProviderAccess } from './StatesSetup';

type Status =
  | { kind: 'empty' }
  | { kind: 'not-recognised' }
  | { kind: 'wrong-provider'; detected: Provider }
  | { kind: 'checking'; name: EnvKeyName }
  | { kind: 'ready'; name: EnvKeyName }
  | { kind: 'rejected'; name: EnvKeyName }
  | { kind: 'unreachable'; name: EnvKeyName }
  | { kind: 'blocked'; name: EnvKeyName };

const what = (name: EnvKeyName) => (name === 'PEXELS_API_KEY' ? 'Media search now includes Pexels photos and videos.' : 'It writes your clips and makes the changes you ask for.');
const origins = (name: EnvKeyName): readonly string[] => HOSTS[providerForKey(name) ?? 'pexels'];

function Detected({ name, ready, compact }: { name: EnvKeyName; ready: boolean; compact?: boolean }) {
  return (
    <div role="status" style={{ padding: compact ? 12 : '12px 14px', borderRadius: compact ? 12 : 14, background: ready ? 'var(--success-bg)' : 'var(--surface)', border: compact ? 0 : `1px solid ${ready ? 'var(--success-line)' : 'var(--line)'}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ready ? 'var(--success-ink)' : 'var(--accent)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>This is a {serviceLabel(name)} key{ready ? ' · Ready' : ''}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{what(name)}</span>
      </span>
    </div>
  );
}

/** One key field: paste or a 600 ms pause checks it, never each keystroke; a newer input drops older results. */
function useKeyField(field: KeyField, expected: EnvKeyName) {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'empty' });
  const run = useRef(0);
  const latest = useRef('');

  function check(key: string) {
    const mine = ++run.current;
    setStatus({ kind: 'checking', name: expected });
    verifyKey(expected, key, origins(expected), { request: requestHost, save: async (n, v) => { await mergeKeys({ [n]: v }); if (n !== 'PEXELS_API_KEY') await updateSettings({ keySource: 'paste' }); } })
      .then((verdict) => { if (mine === run.current) setStatus({ kind: verdict === 'ready' ? 'ready' : verdict === 'denied' ? 'blocked' : verdict, name: expected }); })
      .catch((error: unknown) => {
        console.error('Motikord: could not check the key', error);
        if (mine === run.current) setStatus({ kind: 'unreachable', name: expected });
      });
  }

  // A key for another provider pasted in the main field says which provider it belongs to.
  const mismatch = (name: EnvKeyName | null): Status => {
    const detected = field === 'main' && name ? providerForKey(name) : undefined;
    return detected ? { kind: 'wrong-provider', detected } : { kind: 'not-recognised' };
  };
  const watcher = useRef(createKeyWatcher((name, key) => (name === expected ? check(key) : setStatus(mismatch(name))), field));
  useEffect(() => () => watcher.current.cancel(), []);

  function onInput(next: string) {
    setValue(next);
    latest.current = next;
    ++run.current;
    if (!next.trim()) { watcher.current.cancel(); return setStatus({ kind: 'empty' }); }
    const name = detectKey(next, field);
    setStatus(name === expected || (field === 'pexels' && !name) ? { kind: 'empty' } : mismatch(name));
    watcher.current.type(next);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    e.preventDefault();
    setValue(text);
    latest.current = text;
    const name = detectKey(text, field);
    if (name !== expected) { ++run.current; watcher.current.cancel(); return setStatus(mismatch(name)); }
    watcher.current.paste(text);
  }

  return { value, status, onInput, onPaste, retry: () => check(latest.current) };
}

export default function PasteKey() {
  const [provider, setProvider] = useState<Provider | null>(null);
  useEffect(() => {
    getSettings().then((s) => setProvider(s.provider)).catch((error: unknown) => { console.error('Motikord: could not read settings', error); setProvider('groq'); });
  }, []);
  return provider ? <PasteKeyFor key={provider} provider={provider} /> : null;
}

function PasteKeyFor({ provider }: { provider: Provider }) {
  const { back, navigate, replace } = useRouter();
  const info = PROVIDERS[provider];
  const groq = useKeyField('main', info.keyName);
  const pexels = useKeyField('pexels', 'PEXELS_API_KEY');
  const [busy, setBusy] = useState(false);
  const status = groq.status;
  const ps = pexels.status;

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

  const canStart = status.kind === 'ready';
  const switchTo = (detected: Provider) => {
    updateSettings({ provider: detected }).then(() => navigate('Setup'), (error: unknown) => console.error('Motikord: could not save the AI choice', error));
  };
  return (
    <Page frame="PasteKey">
      <StepHead step={2} onBack={back} />
      <Title title={`Add your ${info.label} key`}>Motikord keeps keys only until Chrome closes, and never shows them again.</Title>
      <div style={{ margin: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SourceToggle value="paste" onPick={() => navigate('PenvConnect')} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span>Writing clips with</span><span style={{ fontWeight: 600, color: 'var(--ink)' }}>{info.label}</span>
          <a href="#setup" onClick={(e) => { e.preventDefault(); navigate('Setup'); }} style={{ marginLeft: 'auto', fontWeight: 500 }}>Change</a>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{`${info.label} key`}</span>
          <input
            type="password" value={groq.value} autoComplete="off" spellCheck={false} aria-label={`${info.label} key`} placeholder={`${info.prefix}…`}
            onChange={(e) => groq.onInput(e.target.value)} onPaste={groq.onPaste}
            style={{ height: 44, padding: '0 12px', borderRadius: 10, border: `1px solid ${status.kind === 'rejected' || status.kind === 'not-recognised' || status.kind === 'wrong-provider' ? 'var(--error-line)' : 'var(--line-strong)'}`, background: 'var(--surface)', font: '14px var(--mono)', color: 'var(--ink)' }}
          />
        </label>
        {status.kind === 'checking' && <KeyChecking service={serviceLabel(status.name)} />}
        {status.kind === 'ready' && <Detected name={status.name} ready />}
        {status.kind === 'blocked' && <ProviderAccess provider={provider} onAllow={groq.retry} />}
        {status.kind === 'unreachable' && <KeyCheckUnreachable onTryAgain={groq.retry} />}
        {status.kind === 'not-recognised' && <KeyNotRecognised provider={provider} />}
        {status.kind === 'wrong-provider' && <KeyWrongProvider provider={provider} detected={status.detected} onSwitch={() => switchTo(status.detected)} />}
        {status.kind === 'rejected' && <KeyRejected provider={provider} />}
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>No key yet? <a href={info.keysUrl} target="_blank" rel="noreferrer">{info.getKey}</a></span>
      </div>
      <div style={{ margin: '18px 24px 0', padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Optional: a Pexels key</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Adds free photos and videos from Pexels to media search. Add it any time in Settings. Openverse needs no key.</span>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Pexels key</span>
          <input
            type="password" value={pexels.value} autoComplete="off" spellCheck={false} aria-label="Pexels key"
            onChange={(e) => pexels.onInput(e.target.value)} onPaste={pexels.onPaste}
            style={{ height: 44, padding: '0 12px', borderRadius: 10, border: `1px solid ${ps.kind === 'rejected' || ps.kind === 'not-recognised' ? 'var(--error-line)' : 'var(--line-strong)'}`, background: 'var(--surface)', font: '13px var(--mono)', color: 'var(--ink)' }}
          />
        </label>
        {ps.kind === 'checking' && <KeyChecking service={serviceLabel(ps.name)} />}
        {ps.kind === 'ready' && <Detected name={ps.name} ready compact />}
        {ps.kind === 'blocked' && <ProviderAccess name="Pexels" host="api.pexels.com" onAllow={pexels.retry} />}
        {ps.kind === 'unreachable' && <KeyCheckUnreachable onTryAgain={pexels.retry} />}
        {ps.kind === 'not-recognised' && <KeyNotRecognised provider={provider} />}
        {ps.kind === 'rejected' && <PexelsKeyRejected />}
        <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>Get a free Pexels key</a>
      </div>
      <Footer>
        <Button block busy={busy} disabled={!canStart} onClick={() => void start()}>Start making clips</Button>
      </Footer>
    </Page>
  );
}
