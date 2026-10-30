import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Button, IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { commitEdit, downloadResult, addMediaEdit, readClipRecipe } from '../lib/media/download';
import type { Edit } from '../lib/editor/store';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { deleteMedia } from '../lib/media';
import { clock, chooseMusicEdit } from '../lib/music';
import { LICENCE_TAG, needsCredit } from '../lib/media/licence';
import { MediaSearchError, searchOpenverse, type MediaKind, type MediaResult } from '../lib/media/openverse';
import { searchPexels } from '../lib/media/pexels';
import { getKey, getSettings, onSettingsChanged } from '../lib/settings';
import type { Recipe, Settings } from '../lib/types';
import { AllLicencesOn, LibraryDenied, MediaDownloadFailed, MediaNoResults, MediaOffline, MediaSearching, PexelsNeedsKey } from './StatesMedia';

type Tab = MediaKind;
const TABS: [Tab, string][] = [['image', 'Photos'], ['video', 'Videos'], ['audio', 'Music']];

// "Search free music" in the Music panel opens this screen on its Music tab.
let nextTab: Tab | undefined;
export const openMediaTab = (tab: Tab) => { nextTab = tab; };

/** The clip a dialog edits. The editor tab unmounts while a dialog is open, so edits go to the stored clip and the editor reads them back. */
export function useStoredClip() {
  const { route, back, canGoBack, replace } = useRouter();
  const clipId = route.params.clipId ?? new URLSearchParams(location.search).get('clip') ?? undefined;
  const [recipe, setRecipe] = useState<Recipe>();
  const reload = useCallback(async () => { if (clipId) setRecipe(await readClipRecipe(clipId)); }, [clipId]);
  useEffect(() => { reload().catch((error: unknown) => console.error('Motikord: could not open the clip', error)); }, [reload]);
  const commit = async (edit: Edit | undefined) => {
    if (!clipId || !edit) return false;
    const ok = await commitEdit(clipId, edit);
    if (ok) await reload();
    return ok;
  };
  const close = () => (canGoBack ? back() : replace('Editor', { clipId }));
  return { clipId, sceneId: route.params.sceneId, recipe, commit, close };
}

export function useSettings(): Settings | undefined {
  const [s, setS] = useState<Settings>();
  useEffect(() => {
    void getSettings().then(setS).catch(() => undefined);
    return onSettingsChanged(setS);
  }, []);
  return s;
}

export function CloseIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>;
}

/** The card every dialog sits in. */
export function DialogShell({ width, label, children, style }: { width: number; label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <main data-frame={label} style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', padding: 16, minHeight: 0 }}>
      <div style={{ width, maxWidth: '100%', maxHeight: 'calc(100vh - 32px)', background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', ...style }}>
        {children}
      </div>
    </main>
  );
}

const chip = (on: boolean): CSSProperties => ({
  height: 28, padding: '0 10px', borderRadius: 999, border: on ? '1px solid var(--ink)' : '1px solid var(--line-strong)',
  background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'var(--ink)', font: '12px/1 var(--font)', cursor: 'pointer',
});
const tag: CSSProperties = { padding: '1px 6px', borderRadius: 5, background: 'rgba(17,17,20,0.75)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 10 };

let preview: HTMLAudioElement | undefined;
export function usePreview() {
  const [playing, setPlaying] = useState<string>();
  useEffect(() => () => { preview?.pause(); preview = undefined; }, []);
  return {
    playing,
    toggle(id: string, src: string) {
      preview?.pause();
      if (playing === id) { setPlaying(undefined); return; }
      preview = new Audio(src);
      preview.onended = () => setPlaying(undefined);
      preview.play().catch((error: unknown) => { console.error('Motikord: could not play the preview', error); setPlaying(undefined); });
      setPlaying(id);
    },
  };
}

const originPattern = (url: string) => { try { return `${new URL(url).origin}/*`; } catch { return ''; } };

/** Free media: Openverse needs no key; Pexels uses the session key. Chrome's host prompt opens inside the search click. */
export default function MediaSearch() {
  const { navigate, route } = useRouter();
  const { recipe, sceneId, commit, close } = useStoredClip();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>(() => { const t = nextTab ?? 'image'; nextTab = undefined; return t; });
  const [q, setQ] = useState('');
  const [source, setSource] = useState<'all' | 'openverse' | 'pexels'>('all');
  const [freeOnly, setFreeOnly] = useState(true);
  const [key, setKey] = useState<string>();
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'offline' | 'denied'>('idle');
  const [results, setResults] = useState<MediaResult[]>([]);
  const [searched, setSearched] = useState('');
  const [needsKey, setNeedsKey] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState<MediaResult>();
  const asked = useRef(false);
  const audio = usePreview();

  useEffect(() => { void getKey('pexels').then(setKey).catch(() => undefined); }, []);
  useEffect(() => { if (settings && !asked.current) { asked.current = true; setFreeOnly(!settings.libraries.allLicences); } }, [settings]);

  // First visit without access goes through AccessPrompt once; later visits show library-denied from the search click.
  useEffect(() => {
    if (!settings || !settings.libraries.openverse || tab === 'video') return;
    let live = true;
    void browser.permissions.contains({ origins: [...HOSTS.openverse] }).then((has) => {
      if (live && !has && !sessionStorage.getItem('motikordAccessAsked')) {
        sessionStorage.setItem('motikordAccessAsked', '1');
        navigate('AccessPrompt', route.params);
      }
    }).catch(() => undefined);
    return () => { live = false; };
    // Runs once settings are known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!settings]);

  const ovOn = !!settings?.libraries.openverse;
  const pxOn = !!settings?.libraries.pexels && tab !== 'audio';
  const wantOv = ovOn && source !== 'pexels' && tab !== 'video';
  const wantPx = pxOn && source !== 'openverse';
  const allLicences = !freeOnly;

  async function run(access: Promise<'granted' | 'denied'>, query: string, withKey: string | undefined, lic: boolean) {
    setStatus('searching');
    setPicked(undefined);
    setNeedsKey(wantPx && !withKey);
    if ((await access) === 'denied') { setStatus('denied'); return; }
    const jobs: Promise<MediaResult[]>[] = [];
    if (wantOv) jobs.push(searchOpenverse((u, i) => fetch(u, i), query, tab === 'audio' ? 'audio' : 'image', lic));
    if (wantPx && withKey) jobs.push(searchPexels((u, i) => fetch(u, i), withKey, query, tab === 'video' ? 'video' : 'image'));
    const settled = await Promise.allSettled(jobs);
    const lists = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    const errors = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason as unknown] : []));
    for (const e of errors) if (!(e instanceof MediaSearchError)) console.error('Motikord: could not search free media', e);
    if (errors.some((e) => e instanceof MediaSearchError && e.reason === 'key')) setNeedsKey(true);
    const merged: MediaResult[] = [];
    for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (l[i]) merged.push(l[i]!);
    setResults(merged);
    setSearched(query);
    setStatus(merged.length === 0 && errors.length > 0 && !errors.every((e) => e instanceof MediaSearchError && e.reason === 'key') ? 'offline' : 'done');
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    const withKey = key;
    const origins = [...(wantOv ? HOSTS.openverse : []), ...(wantPx && withKey ? HOSTS.pexels : [])];
    // Called before any await so Chrome still sees the click.
    const access = origins.length ? requestHost(origins) : Promise.resolve('granted' as const);
    void run(access, query, withKey, allLicences);
  }

  function changeFree(on: boolean) {
    setFreeOnly(on);
    if (searched) void run(Promise.resolve('granted'), searched, key, !on);
  }

  function add(r: MediaResult) {
    if (!recipe) return;
    setFailed(undefined);
    setAdding(true);
    // Hosts a file lives on are optional too; asked inside the click, and the download still tries if Chrome says no.
    const access = requestHost([originPattern(r.downloadUrl)]);
    void (async () => {
      await access;
      let path: string | undefined;
      try {
        const asset = await downloadResult(r, { fetch: (u, i) => fetch(u, i) });
        path = asset.opfsPath;
        const scene = recipe.scenes.find((s) => s.id === sceneId) ?? recipe.scenes[0];
        const edit = r.kind === 'audio' ? chooseMusicEdit(recipe, asset) : scene && addMediaEdit(recipe, scene.id, asset, crypto.randomUUID());
        if (!(await commit(edit))) throw new Error('The edit did not apply');
        close();
      } catch (error) {
        console.error('Motikord: could not add free media', error);
        if (path) await deleteMedia(path).catch(() => undefined);
        setFailed(r);
      } finally {
        setAdding(false);
      }
    })();
  }

  const selected = results.find((r) => r.id === picked && r.kind === tab);
  const shown = results.filter((r) => r.kind === tab);
  const sources: [typeof source, string][] = [['all', 'All sources'], ...(ovOn && tab !== 'video' ? [['openverse', 'Openverse'] as [typeof source, string]] : []), ...(pxOn ? [['pexels', 'Pexels'] as [typeof source, string]] : [])];

  const switchTab = (t: Tab) => {
    setTab(t); setResults([]); setStatus('idle'); setPicked(undefined); setFailed(undefined); setNeedsKey(false);
    if ((t === 'video' && source === 'openverse') || (t === 'audio' && source === 'pexels')) setSource('all');
  };

  return (
    <DialogShell width={760} label="MediaSearch" style={{ height: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px 14px 20px', borderBottom: '1px solid var(--line)' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, flexGrow: 1 }}>Free media</h1>
        <div role="tablist" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
          {TABS.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => switchTab(t)}
              style={{ height: 30, padding: '0 14px', border: 0, borderRadius: 6, background: tab === t ? 'var(--surface)' : 'transparent', boxShadow: tab === t ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', color: tab === t ? 'var(--ink)' : 'var(--muted)', font: `${tab === t ? 600 : 400} 12px/1 var(--font)`, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        <IconButton aria-label="Close" onClick={close}><CloseIcon /></IconButton>
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 20px 0' }}>
        <label style={{ height: 42, borderRadius: 10, border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
          <input aria-label="Search free media" value={q} onChange={(e) => setQ(e.target.value)} style={{ flexGrow: 1, border: 0, outline: 'none', background: 'transparent', font: '14px var(--font)', color: 'var(--ink)' }} />
        </label>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {sources.map(([id, label]) => <button key={id} type="button" aria-pressed={source === id} onClick={() => setSource(id)} style={chip(source === id)}>{label}</button>)}
          <span style={{ flexGrow: 1 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input type="checkbox" checked={freeOnly} onChange={(e) => changeFree(e.target.checked)} style={{ accentColor: 'var(--accent)', margin: 0 }} />Only free to use in videos
          </label>
        </div>
      </form>

      <div style={{ flexGrow: 1, display: 'flex', gap: 16, padding: '14px 20px 0', minHeight: 0 }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          {!freeOnly && <AllLicencesOn />}
          {needsKey && source !== 'openverse' && (source === 'pexels' || status !== 'idle') && <PexelsNeedsKey onAddKey={() => { void browser.windows.getCurrent().then((w) => browser.sidePanel.open({ windowId: w.id! })).catch((error: unknown) => console.error('Motikord: could not open the side panel', error)); }} />}
          {status === 'searching' && <MediaSearching />}
          {status === 'denied' && <LibraryDenied onAllow={() => navigate('AccessPrompt', route.params)} />}
          {status === 'offline' && <MediaOffline onUseMedia={() => navigate('YourMedia', route.params)} />}
          {status === 'done' && shown.length === 0 && !(needsKey && source === 'pexels') && <MediaNoResults query={searched} onClear={() => { setQ(''); setResults([]); setStatus('idle'); }} />}
          {failed && <MediaDownloadFailed what={failed.kind === 'image' ? 'photo' : failed.kind === 'video' ? 'video' : 'track'} onRetry={() => add(failed)} />}
          {status === 'done' && tab === 'audio' && shown.length > 0 && (
            <div style={{ borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
              {shown.map((r, i) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid var(--line)' : 0 }}>
                  <button type="button" aria-label={`Play ${r.title}`} onClick={() => audio.toggle(r.id, r.downloadUrl)} style={{ width: 30, height: 30, border: '1px solid var(--line-strong)', borderRadius: '50%', background: 'var(--surface)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--ink)" aria-hidden="true">{audio.playing === r.id ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4v16l13-8z" />}</svg>
                  </button>
                  <span style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{`${r.author} · Openverse${r.durationMs ? ` · ${clock(r.durationMs)}` : ''}`}</span>
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 10, padding: '1px 6px', borderRadius: 5, background: 'var(--stage)' }}>{LICENCE_TAG[r.licence]}</span>
                  <Button variant="secondary" disabled={!recipe} busy={adding} onClick={() => add(r)} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>Use</Button>
                </div>
              ))}
            </div>
          )}
          {tab !== 'audio' && shown.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoRows: 112, gap: 8, alignContent: 'start' }}>
              {shown.map((r) => (
                <button key={`${r.source}-${r.id}`} type="button" aria-pressed={picked === r.id} aria-label={r.title} onClick={() => setPicked(r.id)}
                  style={{ position: 'relative', border: 0, borderRadius: 10, padding: 0, cursor: 'pointer', background: `var(--stage) url("${r.thumbnail}") center / cover`, outline: picked === r.id ? '3px solid var(--accent)' : 'none', outlineOffset: -3 }}>
                  <span style={{ ...tag, position: 'absolute', left: 6, bottom: 6 }}>{r.source === 'pexels' ? 'Pexels' : LICENCE_TAG[r.licence]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {tab !== 'audio' && selected && (
          <aside style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span role="img" aria-label={selected.title} style={{ height: 130, borderRadius: 10, background: `var(--stage) url("${selected.thumbnail}") center / cover` }} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>{selected.title}</span>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '64px 1fr', gap: '6px 8px', fontSize: 12 }}>
              <dt style={{ color: 'var(--muted)' }}>By</dt><dd style={{ margin: 0 }}>{selected.author}</dd>
              <dt style={{ color: 'var(--muted)' }}>From</dt><dd style={{ margin: 0 }}>{selected.source === 'pexels' ? 'Pexels' : 'Openverse'}</dd>
              <dt style={{ color: 'var(--muted)' }}>Licence</dt><dd style={{ margin: 0 }}>{selected.licenceLabel}</dd>
              {selected.width && selected.height && <><dt style={{ color: 'var(--muted)' }}>Size</dt><dd style={{ margin: 0, fontFamily: 'var(--mono)' }}>{`${selected.width} × ${selected.height}`}</dd></>}
            </dl>
            {needsCredit(selected.licence) && <span style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--warning-bg)', fontSize: 12, lineHeight: 1.45, color: 'var(--warning-ink)' }}>Needs a credit. Motikord adds it to credits.txt for you.</span>}
            <a href={selected.pageUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 500, textDecoration: 'none' }}>{`See it on ${selected.source === 'pexels' ? 'Pexels' : 'Openverse'}`}</a>
            <div style={{ flexGrow: 1 }} />
            <Button block disabled={!recipe} busy={adding} onClick={() => add(selected)}>Add to clip</Button>
          </aside>
        )}
      </div>

      <div style={{ padding: '12px 20px 14px', marginTop: 12, borderTop: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--faint)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        Only your search words go to Openverse and Pexels. Files you add are downloaded once and kept on this computer.
      </div>
    </DialogShell>
  );
}
