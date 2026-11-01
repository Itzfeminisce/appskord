import { useEffect, useRef, useState } from 'react';
import { createKeyWatcher, detectKey, verifyKey } from '@appskord/llm';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { loadKeys, mergeKeys } from '../lib/penv';
import { getSettings, updateSettings } from '../lib/settings';
import { BackButton, Page, Title } from './Setup';
import { ImageKeyRejected } from './StatesMedia';

type Check = 'empty' | 'checking' | 'ready' | 'rejected' | 'unreachable';
const NAMES = ['OPENAI_API_KEY'] as const;
const card = { padding: 14, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 } as const;
const ghost = { height: 32, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: 'var(--surface)', font: '600 12px/1 var(--font)', color: 'var(--ink)', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' } as const;

/** Settings: AI images key. The image key is the OpenAI key; Penv Cloud shares it, or paste one. */
export default function ImageKey() {
  const { back, navigate } = useRouter();
  const [on, setOn] = useState(true);
  const [fromPenv, setFromPenv] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<Check>('empty');
  const run = useRef(0);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
      setOn(s.aiImages);
      setFromPenv(s.keySource === 'penv-app');
      setHasKey(!!(await loadKeys()).OPENAI_API_KEY);
    })().catch((error: unknown) => console.error('Motikord: could not read the image key', error));
  }, []);

  function verify(key: string) {
    const mine = ++run.current;
    setCheck('checking');
    verifyKey('OPENAI_API_KEY', key, HOSTS.openai, { request: requestHost, save: async (n, v) => { await mergeKeys({ [n]: v }); setHasKey(true); setFromPenv(false); } })
      .then((v) => { if (mine === run.current) setCheck(v === 'ready' ? 'ready' : v === 'denied' ? 'unreachable' : v); })
      .catch((error: unknown) => { console.error('Motikord: could not check the image key', error); if (mine === run.current) setCheck('unreachable'); });
  }
  const watcher = useRef(createKeyWatcher((name, key) => { if (name === 'OPENAI_API_KEY') verify(key); }, { field: 'main', names: [...NAMES] }));
  useEffect(() => () => watcher.current.cancel(), []);

  function onInput(next: string) {
    setValue(next);
    ++run.current;
    if (!next.trim()) { watcher.current.cancel(); return setCheck('empty'); }
    setCheck('empty');
    watcher.current.type(next);
  }

  async function toggle() {
    const next = !on;
    setOn(next);
    await updateSettings({ aiImages: next }).catch((error: unknown) => console.error('Motikord: could not save AI images', error));
  }

  const ready = check === 'ready' || (hasKey && check === 'empty');
  return (
    <Page frame="ImageKey">
      <div style={{ padding: '20px 24px 0' }}><BackButton onBack={back} /></div>
      <Title title="AI images">Makes a picture for an empty image slot when no photo fits. Only the slot&apos;s few-word description goes to the image provider.</Title>
      <div style={{ margin: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
          <span style={{ flexGrow: 1 }}>AI images</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{on ? 'On' : 'Off'}</span>
          <input type="checkbox" role="switch" aria-label="AI images" checked={on} onChange={() => void toggle()} style={{ accentColor: 'var(--accent)' }} />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span style={{ color: 'var(--muted)' }}>Image provider</span><span style={{ fontWeight: 600, marginLeft: 'auto' }}>OpenAI</span>
        </div>
        <div style={card}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Image key</span>
          {hasKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span className="mono" style={{ fontWeight: 500 }}>OPENAI_API_KEY</span>
              {fromPenv && <span style={{ fontSize: 11, color: 'var(--muted)' }}>From Penv Cloud</span>}
              <span style={{ fontSize: 12, color: 'var(--success-ink)', fontWeight: 600 }}>· Ready</span>
              <button type="button" onClick={() => navigate('PenvConnected')} style={{ ...ghost, marginLeft: 'auto' }}>Change</button>
            </div>
          )}
          {!pasting && <button type="button" onClick={() => setPasting(true)} style={{ ...ghost, alignSelf: 'flex-start' }}>Paste a key instead</button>}
          {pasting && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>OpenAI key</span>
                <input type="password" value={value} autoComplete="off" spellCheck={false} aria-label="OpenAI key" placeholder="sk-…" onChange={(e) => onInput(e.target.value)}
                  onPaste={(e) => { const t = e.clipboardData.getData('text'); if (!t.trim()) return; e.preventDefault(); setValue(t); if (detectKey(t, { field: 'main', names: [...NAMES] })) watcher.current.paste(t); }}
                  style={{ height: 44, padding: '0 12px', borderRadius: 10, border: `1px solid ${check === 'rejected' ? 'var(--error-line)' : 'var(--line-strong)'}`, background: 'var(--surface)', font: '14px var(--mono)', color: 'var(--ink)' }} />
              </label>
              {check === 'checking' && <span role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>Checking the key…</span>}
              {check === 'ready' && <span role="status" style={{ fontSize: 13, fontWeight: 600, color: 'var(--success-ink)' }}>This is an OpenAI key · Ready</span>}
              {check === 'rejected' && <ImageKeyRejected />}
              {check === 'unreachable' && <span role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>Couldn&apos;t reach OpenAI. Check your connection.</span>}
            </>
          )}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>Get an OpenAI key</a>
        </div>
        {!ready && !pasting && <button type="button" onClick={() => navigate('PenvConnect')} style={{ ...ghost, alignSelf: 'flex-start' }}>Connect Penv Cloud</button>}
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Only the slot&apos;s few-word description goes to OpenAI, never your media. Each image keeps the credit “AI image, OpenAI”.</span>
      </div>
    </Page>
  );
}
