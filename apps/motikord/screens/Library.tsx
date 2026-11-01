import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { updateClip } from '../lib/db';
import { cleanName, clipDate, duplicate, ensureThumbnail, filterClips, footerText, libraryDeps, measureSpace, removeClip, sortClips, type TypeFilter } from '../lib/library';
import { onMessage, send } from '../lib/messages';
import { clipDuration } from '../lib/render/drawFrame';
import { formatLength } from '../lib/templates';
import type { Clip } from '../lib/types';
import LibraryEmpty from './LibraryEmpty';
import { ClipDeleted, ClipDuplicated, DeleteConfirm, LibraryNoResults, RenameField, useAutoDismiss } from './StatesLibrary';
import { TYPE_NAMES, TYPE_ORDER } from './Templates';
import { BackButton } from './Setup';

type Toast = { kind: 'deleted'; name: string } | { kind: 'duplicated'; name: string; id: string };

const menuItem = { height: 34, padding: '0 10px', border: 0, borderRadius: 8, background: 'transparent', font: '13px var(--font)', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)' } as const;
const chipStyle = (on: boolean) => ({ height: 28, padding: '0 10px', borderRadius: 999, border: on ? 0 : '1px solid #E0E0E4', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', font: '12px var(--font)', display: 'flex', alignItems: 'center', flexShrink: 0, cursor: 'pointer' }) as const;

/** The stored picture, drawn and kept on first sight when the clip has none. */
function Thumb({ clip }: { clip: Clip }) {
  const [url, setUrl] = useState<string>();
  const first = clip.recipe.scenes[0];
  const latest = useRef(clip);
  latest.current = clip;
  const shown = useRef<string | undefined>(undefined);
  useEffect(() => {
    const stop = new AbortController();
    ensureThumbnail(latest.current, stop.signal)
      .then((blob) => {
        if (stop.signal.aborted || !blob) return;
        const next = URL.createObjectURL(blob);
        const img = new Image();
        const swap = () => {
          if (stop.signal.aborted) { URL.revokeObjectURL(next); return; }
          const old = shown.current;
          shown.current = next;
          setUrl(next);
          if (old) URL.revokeObjectURL(old);
        };
        img.onload = swap;
        img.onerror = swap;
        img.src = next;
      })
      .catch((error: unknown) => console.error('Motikord: could not draw a thumbnail', error));
    return () => stop.abort();
  }, [clip.id, clip.updatedAt]);
  useEffect(() => () => { if (shown.current) URL.revokeObjectURL(shown.current); }, []);
  return (
    <span style={{ height: 200, borderRadius: 12, background: first?.background === 'transparent' || !first ? 'var(--stage)' : first.background, border: '1px solid var(--line)', position: 'relative', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
      <span className="mono" style={{ position: 'absolute', left: 8, bottom: 8, padding: '1px 6px', borderRadius: 5, background: 'rgba(17,17,20,0.75)', color: '#FFFFFF', fontSize: 10 }}>{formatLength(clipDuration(clip.recipe))}</span>
    </span>
  );
}

export default function Library() {
  const { replace } = useRouter();
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<Clip | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  useAutoDismiss(toast !== null, closeToast, 6000);

  const reload = useCallback(async () => {
    try {
      const all = sortClips(await libraryDeps.list());
      setClips(all);
      setBytes(await measureSpace(all));
    } catch (error) {
      console.error('Motikord: could not list your clips', error);
      setClips((c) => c ?? []);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => onMessage({ 'clip/saved': () => { void reload(); } }), [reload]);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!(e.target as Element).closest('[data-menu]')) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const shown = useMemo(() => filterClips(clips ?? [], query, type), [clips, query, type]);
  const home = () => replace('Home');
  const open = (id: string) => { void send({ type: 'editor/open', clipId: id }); };
  const fail = (what: string) => (error: unknown) => console.error(`Motikord: could not ${what}`, error);

  const saveName = async () => {
    const r = renaming;
    setRenaming(null);
    const clip = clips?.find((c) => c.id === r?.id);
    const name = r && clip ? cleanName(r.text, clip.recipe.name) : undefined;
    if (!r || !name) return;
    try {
      await updateClip(r.id, (c) => ({ recipe: { ...c.recipe, name }, updatedAt: Date.now() }));
      void send({ type: 'clip/saved', clipId: r.id });
      await reload();
    } catch (error) { fail('rename the clip')(error); }
  };
  const copy = async (clip: Clip) => {
    setMenu(null);
    try {
      const made = await duplicate(clip);
      setToast({ kind: 'duplicated', name: made.recipe.name, id: made.id });
      await reload();
    } catch (error) { fail('duplicate the clip')(error); }
  };
  const remove = async () => {
    const clip = deleting;
    setDeleting(null);
    if (!clip) return;
    try {
      await removeClip(clip.id);
      setToast({ kind: 'deleted', name: clip.recipe.name });
      await reload();
    } catch (error) { fail('delete the clip')(error); }
  };

  if (clips === null) return <main data-frame="Library" style={{ flexGrow: 1 }} />;
  if (clips.length === 0) return <LibraryEmpty />;

  return (
    <main data-frame="Library" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <BackButton onBack={home} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, flexGrow: 1 }}>Your clips</h1>
        <button type="button" onClick={home} style={{ height: 34, padding: '0 12px', border: 0, borderRadius: 9, background: 'var(--accent)', color: '#fff', font: '600 13px var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>New
        </button>
      </div>
      <label style={{ margin: '12px 16px 0', height: 40, borderRadius: 10, border: '1px solid #E0E0E4', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
        <input aria-label="Search your clips" placeholder="Search your clips" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 'none', font: '13px var(--font)', background: 'transparent', color: 'var(--ink)' }} />
        {query !== '' && (
          <button type="button" aria-label="Clear search" onClick={() => setQuery('')} style={{ width: 26, height: 26, border: 0, borderRadius: 7, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        )}
      </label>
      <div role="group" aria-label="Clip type" style={{ display: 'flex', gap: 6, padding: '10px 16px 0', overflowX: 'auto' }}>
        <button type="button" aria-pressed={type === 'all'} style={chipStyle(type === 'all')} onClick={() => setType('all')}>All</button>
        {TYPE_ORDER.map((t) => <button key={t} type="button" aria-pressed={type === t} style={chipStyle(type === t)} onClick={() => setType(t)}>{TYPE_NAMES[t]}</button>)}
      </div>

      {shown.length === 0 ? (
        <div style={{ padding: '14px 16px 0' }}><LibraryNoResults query={query.trim() || (type === 'all' ? '' : TYPE_NAMES[type])} onClear={() => { setQuery(''); setType('all'); }} onNew={home} /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, padding: '14px 16px 0' }}>
          {shown.map((c) => (
            <div key={c.id} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <button type="button" aria-label={`Open ${c.recipe.name}`} onClick={() => open(c.id)} style={{ border: 0, padding: 0, background: 'none', display: 'block', cursor: 'pointer' }}><Thumb clip={c} /></button>
              {renaming?.id === c.id ? (
                <RenameField value={renaming.text} onChange={(text) => setRenaming({ id: c.id, text })} onSave={() => { void saveName(); }} onCancel={() => setRenaming(null)} />
              ) : (
                <>
                  <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.recipe.name}</span>
                    <button type="button" data-menu aria-label={`More for ${c.recipe.name}`} aria-haspopup="menu" aria-expanded={menu === c.id} onClick={() => setMenu(menu === c.id ? null : c.id)}
                      style={{ width: 30, height: 30, flexShrink: 0, border: 0, borderRadius: 8, background: menu === c.id ? '#E8E8EB' : 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--ink)" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
                    </button>
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6 }}>{[TYPE_NAMES[c.recipe.type], clipDate(c.updatedAt), c.exportedAt ? 'Exported' : null].filter(Boolean).join(' · ')}</span>
                </>
              )}
              {menu === c.id && (
                <div role="menu" data-menu style={{ position: 'absolute', right: -6, top: 236, zIndex: 2, width: 170, padding: 6, borderRadius: 12, background: 'var(--surface)', boxShadow: '0 12px 32px rgba(16,16,20,0.18), 0 0 0 1px rgba(16,16,20,0.06)', display: 'flex', flexDirection: 'column' }}>
                  <button type="button" role="menuitem" style={menuItem} onClick={() => { setMenu(null); open(c.id); }}>Open</button>
                  <button type="button" role="menuitem" style={menuItem} onClick={() => { void copy(c); }}>Duplicate</button>
                  <button type="button" role="menuitem" style={menuItem} onClick={() => { setMenu(null); setRenaming({ id: c.id, text: c.recipe.name }); }}>Rename</button>
                  <button type="button" role="menuitem" style={{ ...menuItem, color: 'var(--error-ink)' }} onClick={() => { setMenu(null); setDeleting(c); }}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ flexGrow: 1 }} />
      <span style={{ padding: '12px 24px 16px', fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{bytes === null ? `${clips.length} ${clips.length === 1 ? 'clip' : 'clips'}` : footerText(clips.length, bytes)}</span>

      {deleting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(16,16,20,0.4)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 5 }}>
          <div style={{ width: '100%' }}><DeleteConfirm name={deleting.recipe.name} onCancel={() => setDeleting(null)} onDelete={() => { void remove(); }} /></div>
        </div>
      )}
      {toast && (
        <div style={{ position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 6 }}>
          {toast.kind === 'deleted' ? <ClipDeleted name={toast.name} /> : <ClipDuplicated name={toast.name} onOpen={() => { open(toast.id); setToast(null); }} />}
        </div>
      )}
    </main>
  );
}
