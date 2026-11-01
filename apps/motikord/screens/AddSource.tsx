import { useState, type CSSProperties } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { requestHost } from '../lib/hostAccess';
import { KEY_PLACEMENTS, linkHost, linkOrigin, mainKind, normaliseLink, testSource, type TestResult } from '../lib/media/sources/custom';
import { FORMAT_NAME } from '../lib/media/sources/parsers';
import { getSettings, setKey, updateSettings } from '../lib/settings';
import type { CustomFormat, CustomSource, KeyPlacement } from '../lib/types';
import { BackButton } from './Setup';
import { CustomNeedsKey, CustomNoResults, CustomNotALink, CustomOk, CustomUnreadable, inputStyle, SourceAccess, SourceDown, SourceTesting } from './StatesSources';

type Kind = CustomSource['kinds'][number];
const KINDS: [Kind, string][] = [['image', 'Photos'], ['video', 'Videos'], ['audio', 'Music']];
const lbl: CSSProperties = { fontSize: 12, fontWeight: 600 };
const hint: CSSProperties = { fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' };
const field: CSSProperties = { ...inputStyle, font: '13px var(--font)' };
const chip = (on: boolean): CSSProperties => ({
  height: 30, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line-strong)'}`, background: on ? 'var(--tint)' : 'var(--surface)',
  color: on ? 'var(--accent-press)' : 'var(--ink)', font: '500 12px var(--font)', cursor: 'pointer',
});
// "Try another word" walks this list; the first is the frame's “bread”.
const WORDS = ['bread', 'flower', 'city', 'music', 'sea'];

type State = { kind: 'idle' } | { kind: 'testing' } | { kind: 'denied'; host: string } | TestResult;

/** "Add your own source": a search link, an optional key, a test search that must pass, then Chrome's host prompt. */
export default function AddSource() {
  const { navigate, back, canGoBack } = useRouter();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [kinds, setKinds] = useState<Kind[]>(['image']);
  const [key, setKeyValue] = useState('');
  const [keyAs, setKeyAs] = useState<KeyPlacement>('bearer');
  const [keyHeader, setKeyHeader] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [word, setWord] = useState(0);
  const [anyway, setAnyway] = useState<CustomFormat>();
  const [saving, setSaving] = useState(false);

  const normal = normaliseLink(link);
  const host = normal ? linkHost(normal) : '';
  const spec = { keyAs, keyHeader };
  const leave = () => (canGoBack ? back() : navigate('MediaSources'));
  // Any change to what the test used means testing again.
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setState({ kind: 'idle' }); setAnyway(undefined); };

  function test(w = word) {
    if (!normal) { setState({ kind: 'not-a-link' }); return; }
    const access = requestHost([linkOrigin(normal)]);
    setState({ kind: 'testing' });
    setAnyway(undefined);
    void (async () => {
      if ((await access) === 'denied') { setState({ kind: 'denied', host }); return; }
      try {
        setState(await testSource((u, i) => fetch(u, i), name.trim(), normal, key.trim() || undefined, spec, WORDS[w % WORDS.length]));
      } catch (error) {
        console.error('Motikord: could not test the source', error instanceof Error ? error.name : undefined);
        setState({ kind: 'down' });
      }
    })();
  }

  const format: CustomFormat | undefined = state.kind === 'ok' ? state.format : anyway;

  function add() {
    if (!normal || !format) return;
    const access = requestHost([linkOrigin(normal)]);
    setSaving(true);
    void (async () => {
      if ((await access) === 'denied') { setState({ kind: 'denied', host }); setSaving(false); return; }
      const id = crypto.randomUUID();
      const source: CustomSource = {
        id, name: name.trim() || host, url: normal, kinds: kinds.length ? kinds : ['image'], format, on: true,
        ...(key.trim() ? { keyAs, ...(keyAs === 'header' ? { keyHeader: keyHeader.trim() } : {}) } : {}),
      };
      try {
        if (key.trim()) await setKey(`custom:${id}`, key.trim());
        const current = await getSettings();
        await updateSettings({ media: { custom: [...current.media.custom, source] } });
        navigate('MediaSources');
      } catch (error) {
        console.error('Motikord: could not add the source', error instanceof Error ? error.name : undefined);
      } finally {
        setSaving(false);
      }
    })();
  }

  const canAdd = !!format && !!normal && state.kind !== 'testing' && !saving;
  const found = state.kind === 'ok' ? mainKind(state.results) : undefined;

  return (
    <main data-frame="AddSource" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--ground)', color: 'var(--ink)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <BackButton onBack={leave} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Add your own source</h1>
      </div>

      <div style={{ margin: '12px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={lbl}>Name</span>
          <input value={name} onChange={(e) => edit(setName)(e.target.value)} aria-label="Name" style={field} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={lbl}>Search link</span>
          <input value={link} onChange={(e) => edit(setLink)(e.target.value)} aria-label="Search link" spellCheck={false} autoComplete="off" style={inputStyle} />
          <span style={hint}>Paste the link a search page or API uses. Put <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink)' }}>{'{query}'}</span> where the search words go. Motikord adds it if you leave it out.</span>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={lbl}>It has</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {KINDS.map(([k, label]) => {
              const on = kinds.includes(k);
              return <button key={k} type="button" aria-pressed={on} onClick={() => setKinds(on ? kinds.filter((x) => x !== k) : [...kinds, k])} style={chip(on)}>{label}</button>;
            })}
          </div>
        </div>
        <div style={{ height: 1, background: '#EFEFF1', margin: '0 -14px' }} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={lbl}>Key <span style={{ fontWeight: 400, color: 'var(--faint)' }}>Optional</span></span>
          <input type="password" value={key} onChange={(e) => edit(setKeyValue)(e.target.value)} aria-label="Key" autoComplete="off" spellCheck={false} style={inputStyle} />
          <span style={hint}>Only if the source asks for one. Kept like your other keys, until Chrome closes.</span>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={lbl}>Send the key as</span>
          <select value={keyAs} onChange={(e) => edit(setKeyAs)(e.target.value as KeyPlacement)} style={{ ...field, padding: '0 8px' }}>
            {KEY_PLACEMENTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
        {keyAs === 'header' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={lbl}>Header name</span>
            <input value={keyHeader} onChange={(e) => edit(setKeyHeader)(e.target.value)} aria-label="Header name" placeholder="X-API-Key" spellCheck={false} autoComplete="off" style={inputStyle} />
            <span style={hint}>The name the source gives for its key header. The key is sent as its value.</span>
          </label>
        )}
        <button type="button" onClick={() => test()} disabled={state.kind === 'testing'}
          style={{ height: 38, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: 'var(--surface)', font: '600 12px var(--font)', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
          Test with “bread”
        </button>
        {state.kind === 'testing' && <SourceTesting />}
        {state.kind === 'ok' && found && <CustomOk n={found.n} kind={found.kind} format={FORMAT_NAME[state.format]} licenceKnown={state.licenceKnown} thumbs={state.results.filter((r) => r.kind === found.kind).slice(0, 4).map((r) => r.thumbnail)} />}
        {state.kind === 'unreadable' && <CustomUnreadable onRetry={() => test()} />}
        {state.kind === 'needs-key' && <CustomNeedsKey status={state.status} onAddKey={() => (document.querySelector('input[aria-label="Key"]') as HTMLInputElement | null)?.focus()} />}
        {state.kind === 'not-a-link' && <CustomNotALink />}
        {state.kind === 'no-results' && !anyway && <CustomNoResults onTryAnother={() => { const w = word + 1; setWord(w); test(w); }} onAddAnyway={() => setAnyway(state.format ?? 'generic')} />}
        {state.kind === 'down' && <SourceDown source={name.trim() || host} status={state.status} onRetry={() => test()} />}
        {state.kind === 'denied' && <SourceAccess host={state.host} onAllow={() => test()} />}
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" disabled={!canAdd} onClick={add}
          style={{ height: 48, border: 0, borderRadius: 12, background: 'var(--accent)', color: '#fff', font: '600 15px var(--font)', cursor: canAdd ? 'pointer' : 'default', opacity: canAdd ? 1 : 0.45 }}>Add source</button>
        {host && <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>{`Chrome asks once to let Motikord reach ${host}.`}</span>}
      </div>
    </main>
  );
}
