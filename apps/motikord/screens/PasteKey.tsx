import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { createKeyWatcher, detectKey, serviceLabel, verifyKey, type EnvKeyName, type KeyField } from '../lib/keyDetect';
import { mergeKeys } from '../lib/keys';
import { updateSettings } from '../lib/settings';
import { SourceToggle } from './PenvConnect';
import { Footer, Page, StepHead, Title } from './Setup';
import { GroqAccess, KeyChecking, KeyCheckUnreachable, KeyNotRecognised, KeyRejected, PexelsKeyRejected } from './StatesSetup';

type Status =
  | { kind: 'empty' }
  | { kind: 'not-recognised' }
  | { kind: 'checking'; name: EnvKeyName }
  | { kind: 'ready'; name: EnvKeyName }
  | { kind: 'rejected'; name: EnvKeyName }
  | { kind: 'unreachable'; name: EnvKeyName }
  | { kind: 'blocked'; name: EnvKeyName };

const WHAT: Record<EnvKeyName, string> = {
  GROQ_API_KEY: 'It writes your clips and makes the changes you ask for.',
  PEXELS_API_KEY: 'Media search now includes Pexels photos and videos.',
};

const ORIGINS: Record<EnvKeyName, readonly string[]> = { GROQ_API_KEY: HOSTS.groq, PEXELS_API_KEY: HOSTS.pexels };

function Detected({ name, ready, compact }: { name: EnvKeyName; ready: boolean; compact?: boolean }) {
  return (
    <div role="status" style={{ padding: compact ? 12 : '12px 14px', borderRadius: compact ? 12 : 14, background: ready ? 'var(--success-bg)' : 'var(--surface)', border: compact ? 0 : `1px solid ${ready ? 'var(--success-line)' : 'var(--line)'}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ready ? 'var(--success-ink)' : 'var(--accent)'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>This is a {serviceLabel(name)} key{ready ? ' · Ready' : ''}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{WHAT[name]}</span>
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
    verifyKey(expected, key, ORIGINS[expected], { request: requestHost, save: async (n, v) => { await mergeKeys({ [n]: v }); if (n === 'GROQ_API_KEY') await updateSettings({ keySource: 'paste' }); } })
      .then((verdict) => { if (mine === run.current) setStatus({ kind: verdict === 'ready' ? 'ready' : verdict === 'denied' ? 'blocked' : verdict, name: expected }); })
      .catch((error: unknown) => {
        console.error('Motikord: could not check the key', error);
        if (mine === run.current) setStatus({ kind: 'unreachable', name: expected });
      });
  }

  const watcher = useRef(createKeyWatcher((name, key) => (name === expected ? check(key) : setStatus({ kind: 'not-recognised' })), field));
  useEffect(() => () => watcher.current.cancel(), []);

  function onInput(next: string) {
    setValue(next);
    latest.current = next;
    ++run.current;
    if (!next.trim()) { watcher.current.cancel(); return setStatus({ kind: 'empty' }); }
    const name = detectKey(next, field);
    setStatus(name === expected || (field === 'pexels' && !name) ? { kind: 'empty' } : { kind: 'not-recognised' });
    watcher.current.type(next);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!text.trim()) return;
    e.preventDefault();
    setValue(text);
    latest.current = text;
    if (detectKey(text, field) !== expected) { ++run.current; watcher.current.cancel(); return setStatus({ kind: 'not-recognised' }); }
    watcher.current.paste(text);
  }

  return { value, status, onInput, onPaste, retry: () => check(latest.current) };
}

export default function PasteKey() {
  const { back, navigate, replace } = useRouter();
  const groq = useKeyField('main', 'GROQ_API_KEY');
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
  return (
    <Page frame="PasteKey">
      <StepHead step={2} onBack={back} />
      <Title title="Add your Groq key">Motikord keeps keys only until Chrome closes, and never shows them again.</Title>
      <div style={{ margin: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SourceToggle value="paste" onPick={() => navigate('PenvConnect')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Your key</span>
          <input
            type="password" value={groq.value} autoComplete="off" spellCheck={false} aria-label="Your key"
            onChange={(e) => groq.onInput(e.target.value)} onPaste={groq.onPaste}
            style={{ height: 44, padding: '0 12px', borderRadius: 10, border: `1px solid ${status.kind === 'rejected' || status.kind === 'not-recognised' ? 'var(--error-line)' : 'var(--line-strong)'}`, background: 'var(--surface)', font: '14px var(--mono)', color: 'var(--ink)' }}
          />
        </label>
        {status.kind === 'checking' && <KeyChecking service={serviceLabel(status.name)} />}
        {status.kind === 'ready' && <Detected name={status.name} ready />}
        {status.kind === 'blocked' && <GroqAccess onAllow={groq.retry} />}
        {status.kind === 'unreachable' && <KeyCheckUnreachable onTryAgain={groq.retry} />}
        {status.kind === 'not-recognised' && <KeyNotRecognised />}
        {status.kind === 'rejected' && <KeyRejected />}
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>No key yet? <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a free Groq key</a></span>
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
        {ps.kind === 'blocked' && <GroqAccess onAllow={pexels.retry} />}
        {ps.kind === 'unreachable' && <KeyCheckUnreachable onTryAgain={pexels.retry} />}
        {ps.kind === 'not-recognised' && <KeyNotRecognised />}
        {ps.kind === 'rejected' && <PexelsKeyRejected />}
        <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>Get a free Pexels key</a>
      </div>
      <Footer>
        <Button block busy={busy} disabled={!canStart} onClick={() => void start()}>Start making clips</Button>
      </Footer>
    </Page>
  );
}
