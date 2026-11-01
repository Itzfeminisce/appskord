import { useEffect, useRef, useState } from 'react';
import { createKeyWatcher, detectKey, verifyKey } from '@appskord/llm';
import { useRouter } from '../entrypoints/sidepanel/router';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { loadKeys, mergeKeys } from '../lib/penv';
import { getSettings } from '../lib/settings';
import { BackButton, Page, Title } from './Setup';
import { ImageKeyRejected } from './StatesMedia';

type Check = 'empty' | 'checking' | 'ready' | 'rejected' | 'unreachable';
const NAMES = ['OPENAI_API_KEY'] as const;
const label = { fontSize: 13, fontWeight: 600 } as const;
const change = { height: 32, padding: '0 14px', border: '1px solid #E0E0E4', borderRadius: 9, background: 'var(--surface)', font: '600 13px/1 var(--font)', color: 'var(--ink)', cursor: 'pointer', flexShrink: 0, marginLeft: 'auto' } as const;
const shield = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" /></svg>;
const keyIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></svg>;
const tickIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const dot = <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success-ink)' }} />;

/** The AI images key panel: provider, the OpenAI key (Penv Cloud or pasted) and the privacy note. Shown inline in Settings. */
export function ImageKeyPanel({ embedded }: { embedded?: boolean }) {
  const { navigate } = useRouter();
  const [fromPenv, setFromPenv] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<Check>('empty');
  const run = useRef(0);

  useEffect(() => {
    (async () => {
      const s = await getSettings();
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

  return (
    <div style={{ margin: embedded ? '0 14px 14px' : '18px 24px 0', padding: 14, borderRadius: 12, background: '#FAFAFB', border: '1px solid #EFEFF1', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ ...label, flexGrow: 1 }}>Image provider</span>
        <select aria-label="Image provider" defaultValue="openai" style={{ height: 32, border: '1px solid #E0E0E4', borderRadius: 9, padding: '0 8px', font: '13px var(--font)', background: 'var(--surface)', color: 'var(--ink)' }}><option value="openai">OpenAI</option></select>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>Image key</span>
        <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)' }}>
          {hasKey ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12 }}>
              <span className="mono" aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0 }}>pv</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>OPENAI_API_KEY</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  {fromPenv && <span style={{ height: 20, padding: '0 7px', borderRadius: 999, background: 'var(--tint-strong)', color: 'var(--accent-hover)', fontSize: 11, fontWeight: 500, display: 'flex', alignItems: 'center' }}>From Penv Cloud</span>}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success-ink)' }}>{dot}<span>Ready</span></span>
                </span>
              </span>
              <button type="button" onClick={() => navigate('PenvConnected')} style={change}>Change</button>
            </div>
          ) : (
            <button type="button" onClick={() => navigate('PenvConnect')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, border: 0, background: 'none', font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer', textAlign: 'left' }}>Connect Penv Cloud</button>
          )}
          <div style={{ height: 1, background: '#EFEFF1' }} />
          <button type="button" aria-expanded={pasting} onClick={() => setPasting(!pasting)} style={{ padding: '11px 12px', border: 0, background: 'none', font: '500 13px var(--font)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
            Paste a key instead
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={pasting ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
          </button>
          {pasting && (
            <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>OpenAI key</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', borderRadius: 10, background: 'var(--surface)', border: `1px solid ${check === 'rejected' ? 'var(--error-line)' : 'var(--accent)'}`, boxShadow: check === 'rejected' ? undefined : '0 0 0 3px var(--tint)' }}>
                  {keyIcon}
                  <input type="password" value={value} autoComplete="off" spellCheck={false} aria-label="OpenAI key" placeholder="sk-…" onChange={(e) => onInput(e.target.value)}
                    onPaste={(e) => { const t = e.clipboardData.getData('text'); if (!t.trim()) return; e.preventDefault(); setValue(t); if (detectKey(t, { field: 'main', names: [...NAMES] })) watcher.current.paste(t); }}
                    style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', font: '13px var(--mono)', color: 'var(--ink)' }} />
                </span>
              </label>
              {check === 'checking' && <span role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>Checking the key…</span>}
              {check === 'ready' && <span role="status" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--success-ink)' }}>{tickIcon}This is an OpenAI key · Ready</span>}
              {check === 'rejected' && <ImageKeyRejected />}
              {check === 'unreachable' && <span role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>Couldn&apos;t reach OpenAI. Check your connection.</span>}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500 }}>Get an OpenAI key</a>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {shield}
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Only the slot&apos;s few-word description goes to OpenAI, never your media. Each image keeps the credit “AI image, OpenAI”.</span>
      </div>
    </div>
  );
}

/** Deep link to the AI images key. Settings shows the same panel inline under the AI images switch. */
export default function ImageKey() {
  const { back } = useRouter();
  return (
    <Page frame="ImageKey">
      <div style={{ padding: '20px 24px 0' }}><BackButton onBack={back} /></div>
      <Title title="AI images">Makes a picture for an empty image slot when no photo fits. Only the slot&apos;s few-word description goes to the image provider.</Title>
      <ImageKeyPanel />
    </Page>
  );
}
