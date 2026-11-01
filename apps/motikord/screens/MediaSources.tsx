import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { requestHost } from '../lib/hostAccess';
import { BUILTINS, isOn, type BuiltinSource } from '../lib/media/sources/builtins';
import { linkHostPath } from '../lib/media/sources/custom';
import { sourceRuns } from '../lib/media/sources/search';
import { getSourceStatus, setSourceStatus, type SourceStatus } from '../lib/media/sources/status';
import { KEY_SHAPES } from '../lib/media/sources/summary';
import { clearKey, getKey, getSettings, onSettingsChanged, setKey, updateSettings } from '../lib/settings';
import type { CustomSource, Settings } from '../lib/types';
import { BackButton } from './Setup';
import { RowStatus, SourceAddKey, SourceDown, SourceKeyRejected, SourceRemoved } from './StatesSources';

const card: CSSProperties = { margin: '0 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: '1px solid #EFEFF1', color: 'var(--ink)', textDecoration: 'none' };
const first = (i: number): CSSProperties => (i === 0 ? { borderTop: 0 } : {});
const mono = (own?: boolean): CSSProperties => ({ width: 30, height: 30, borderRadius: 8, background: own ? 'var(--tint)' : 'var(--ink)', color: own ? 'var(--accent-press)' : '#fff', fontFamily: 'var(--mono)', fontSize: 11, display: 'grid', placeItems: 'center', flexShrink: 0 });
const tagStyle: CSSProperties = { fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, background: '#F1F1F3', color: 'var(--muted)' };
const warnTag: CSSProperties = { ...tagStyle, background: 'var(--warning-bg)', color: 'var(--warning-ink)' };
const btn2: CSSProperties = { height: 32, padding: '0 12px', border: '1px solid var(--line-strong)', borderRadius: 9, background: 'var(--surface)', font: '600 12px var(--font)', color: 'var(--ink)', cursor: 'pointer', flexShrink: 0 };
const bin = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></svg>;
const UNDO_MS = 10_000;
const KIND_TAG = { image: 'Photos', video: 'Videos', audio: 'Music' } as const;

function Section({ title, small }: { title: string; small?: string }) {
  return <h2 style={{ margin: '20px 24px 8px', fontSize: 13, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>{title}{small && <small style={{ fontSize: 12, fontWeight: 400, color: 'var(--faint)' }}>{small}</small>}</h2>;
}

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={on ? 'On' : 'Off'} title={label} onClick={() => onChange(!on)}
      style={{ position: 'relative', width: 34, height: 20, borderRadius: 999, border: 0, padding: 0, background: on ? 'var(--accent)' : '#DCDCE0', flexShrink: 0, cursor: 'pointer', transition: 'background 150ms' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,16,20,0.2)', transition: 'left 150ms' }} />
    </button>
  );
}

function SourceRow({ i, m, own, name, line, lineMono, tags, warn, end }: { i: number; m: string; own?: boolean; name: string; line: string; lineMono?: boolean; tags: string[]; warn?: string; end: ReactNode }) {
  return (
    <div style={{ ...row, ...first(i) }}>
      <span style={mono(own)} aria-hidden="true">{m}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: lineMono ? 11 : 12, lineHeight: 1.45, color: 'var(--muted)', ...(lineMono ? { fontFamily: 'var(--mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}) }}>{line}</span>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{tags.map((t) => <span key={t} style={tagStyle}>{t}</span>)}{warn && <span style={warnTag}>{warn}</span>}</span>
      </span>
      {end}
    </div>
  );
}

const monogram = (name: string) => { const t = name.replace(/[^A-Za-z0-9]/g, ''); return `${t.charAt(0).toUpperCase()}${t.charAt(1).toLowerCase()}`; };

/** Where Free media looks. Ready-now sources switch on and off; key sources turn on with a key; custom sources come from AddSource. */
export default function MediaSources() {
  const { navigate, back, canGoBack } = useRouter();
  const [s, setS] = useState<Settings>();
  const [keys, setKeys] = useState<Record<string, string | undefined>>({});
  const [status, setStatus] = useState<Record<string, SourceStatus>>({});
  const [adding, setAdding] = useState<BuiltinSource>();
  const [retrying, setRetrying] = useState<string>();
  const [removed, setRemoved] = useState<{ source: CustomSource; index: number; key?: string }>();
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void getSettings().then(setS).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    void Promise.all(BUILTINS.flatMap((b) => (b.key ? [getKey(b.key.name).then((k) => [b.key!.name, k] as const)] : []))).then((pairs) => setKeys(Object.fromEntries(pairs))).catch(() => undefined);
    void getSourceStatus().then(setStatus);
    const off = onSettingsChanged(setS);
    return () => { off(); clearTimeout(undoTimer.current); };
  }, []);
  if (!s) return <main data-frame="MediaSources" />;

  const media = s.media;
  const setOn = (b: BuiltinSource, v: boolean) => void updateSettings({ media: { on: { [b.id]: v } } });
  const setCustom = (c: CustomSource, v: boolean) => void updateSettings({ media: { custom: media.custom.map((x) => (x.id === c.id ? { ...x, on: v } : x)) } });

  /** Takes effect at once, no confirm; the saved key goes too. Undo puts both back for 10 seconds. */
  function remove(c: CustomSource) {
    const index = media.custom.findIndex((x) => x.id === c.id);
    void (async () => {
      const key = await getKey(`custom:${c.id}`);
      await updateSettings({ media: { custom: media.custom.filter((x) => x.id !== c.id) } });
      await clearKey(`custom:${c.id}`);
      clearTimeout(undoTimer.current);
      setRemoved({ source: c, index, ...(key ? { key } : {}) });
      undoTimer.current = setTimeout(() => setRemoved(undefined), UNDO_MS);
    })().catch((error: unknown) => console.error('Motikord: could not remove the source', error instanceof Error ? error.name : undefined));
  }

  function undo() {
    if (!removed) return;
    const { source, index, key } = removed;
    clearTimeout(undoTimer.current);
    setRemoved(undefined);
    void (async () => {
      if (key) await setKey(`custom:${source.id}`, key);
      const current = await getSettings();
      const list = current.media.custom.filter((x) => x.id !== source.id);
      list.splice(Math.min(index, list.length), 0, source);
      await updateSettings({ media: { custom: list } });
    })().catch((error: unknown) => console.error('Motikord: could not restore the source', error instanceof Error ? error.name : undefined));
  }

  function saveKey(b: BuiltinSource, value: string) {
    // Asked inside the click, before anything is awaited, so Chrome still sees the gesture.
    const access = requestHost(b.origins);
    void (async () => {
      await access;
      await setKey(b.key!.name, value);
      await updateSettings({ media: { on: { [b.id]: true } } });
      await setSourceStatus([b.id], {});
      setKeys((k) => ({ ...k, [b.key!.name]: value }));
      setStatus((st) => { const n = { ...st }; delete n[b.id]; return n; });
      setAdding(undefined);
    })().catch((error: unknown) => console.error('Motikord: could not save the key', error instanceof Error ? error.name : undefined));
  }

  /** "Try again" on a source that did not answer: one search for "bread" through the same code Free media uses. */
  function retry(id: string) {
    const run = sourceRuns(media, keys).find((r) => r.id === id);
    if (!run) return;
    const access = requestHost(run.origins);
    setRetrying(id);
    void (async () => {
      await access;
      try {
        await run.search((u, i) => fetch(u, i), 'bread', run.kinds[0]!, media.allLicences);
        await setSourceStatus([id], {});
        setStatus((st) => { const n = { ...st }; delete n[id]; return n; });
      } catch { /* still down; the card stays */ }
      setRetrying(undefined);
    })();
  }

  const ready = BUILTINS.filter((b) => !b.key);
  const keyed = BUILTINS.filter((b) => b.key);
  const down = Object.entries(status).filter(([, v]) => v.state === 'down');
  const nameOf = (id: string) => BUILTINS.find((b) => b.id === id)?.name ?? media.custom.find((c) => c.id === id)?.name ?? id;

  return (
    <main data-frame="MediaSources" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--ground)', color: 'var(--ink)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <BackButton onBack={() => (canGoBack ? back() : navigate('Settings'))} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Media sources</h1>
      </div>
      <p style={{ margin: '4px 24px 0', fontSize: 13, lineHeight: 1.5, color: 'var(--muted)' }}>Where Free media looks for photos, videos and music. Searches go to every source that’s on. If one doesn’t answer, the others still show.</p>

      {removed && <div style={{ margin: '14px 16px 0' }}><SourceRemoved source={removed.source.name} onUndo={undo} /></div>}

      {down.length > 0 && (
        <div style={{ margin: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {down.map(([id, v]) => <SourceDown key={id} source={nameOf(id)} status={v.status} onRetry={retrying ? undefined : () => retry(id)} />)}
        </div>
      )}

      <Section title="Ready now" small="No key needed" />
      <div style={card}>
        {ready.map((b, i) => (
          <SourceRow key={b.id} i={i} m={b.mono} name={b.name} line={b.blurb} tags={b.tags}
            end={status[b.id]?.state === 'down' ? <RowStatus state="down" /> : <Toggle on={isOn(media.on, b)} label={b.name} onChange={(v) => setOn(b, v)} />} />
        ))}
      </div>

      <Section title="Free with a key" small="Keys from Penv Cloud or pasted" />
      <div style={card}>
        {keyed.map((b, i) => {
          const has = !!keys[b.key!.name];
          return (
            <div key={b.id}>
              <SourceRow i={i} m={b.mono} name={b.name} line={b.blurb} tags={b.tags}
                end={has && status[b.id]?.state === 'down' ? <RowStatus state="down" /> : has && status[b.id]?.state !== 'rejected' ? <RowStatus state="on" /> : <button type="button" style={btn2} onClick={() => setAdding(adding?.id === b.id ? undefined : b)}>Add key</button>} />
              {has && status[b.id]?.state === 'rejected' && adding?.id !== b.id && (
                <div style={{ padding: '0 14px 12px' }}><SourceKeyRejected source={b.name} getUrl={b.key!.getUrl} onPaste={() => setAdding(b)} /></div>
              )}
              {adding?.id === b.id && (
                <div style={{ padding: '0 14px 12px' }}>
                  <SourceAddKey source={b.name} getUrl={b.key!.getUrl} ready={(v) => KEY_SHAPES[b.key!.name]?.test(v) ?? true}
                    onSave={(v) => saveKey(b, v)} onPenv={() => navigate('PenvConnect')} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Section title="Your own sources" />
      <div style={card}>
        {media.custom.map((c, i) => (
          <SourceRow key={c.id} i={i} own m={monogram(c.name)} name={c.name} line={linkHostPath(c.url)} lineMono tags={c.kinds.map((k) => KIND_TAG[k])} warn="Check licences"
            end={<>
              <button type="button" aria-label={`Remove ${c.name}`} onClick={() => remove(c)} style={{ ...btn2, width: 32, padding: 0, display: 'grid', placeItems: 'center' }}>{bin}</button>
              {status[c.id]?.state === 'down' ? <RowStatus state="down" /> : <Toggle on={c.on} label={c.name} onChange={(v) => setCustom(c, v)} />}
            </>} />
        ))}
        <a href="#add-source" onClick={(e) => { e.preventDefault(); navigate('AddSource'); }} style={{ ...row, ...first(media.custom.length), color: 'var(--accent)', fontSize: 13, fontWeight: 600, gap: 8 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add a source
        </a>
      </div>
      <span style={{ margin: '8px 24px 0', fontSize: 12, lineHeight: 1.45, color: 'var(--faint)' }}>Paste any search link, with a key if it needs one. Motikord tests it before adding it. Built-in sources can be turned off but not removed.</span>

      <Section title="Licences" />
      <div style={card}>
        <div style={{ ...row, borderTop: 0 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
            <span style={{ fontSize: 13 }}>Only free to use in videos</span>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Hides share-alike and non-commercial media.</span>
          </span>
          <Toggle on={!media.allLicences} label="Only free to use in videos" onChange={(v) => void updateSettings({ media: { allLicences: !v } })} />
        </div>
      </div>

      <div style={{ flexGrow: 1 }} />
      <span style={{ padding: '14px 24px 18px', fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>Only your search words go to each source. Files you add are downloaded once and kept here.</span>
    </main>
  );
}
