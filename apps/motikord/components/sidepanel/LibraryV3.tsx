import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { listClips } from '../../lib/db';
import { clipRowBytes, formatBytes, sortClips } from '../../lib/library';
import { onMessage, send } from '../../lib/messages';
import { clipDuration } from '../../lib/render/drawFrame';
import type { Clip } from '../../lib/types';
import LibraryEmpty from '../../screens/LibraryEmpty';
import { BackButton } from '../../screens/Setup';
import { RecipeThumb } from '../../screens/Templates';
import { LIBRARY } from './copy';
import { seconds } from './clips';
import { clipKind, packNameOf, type ClipKind } from './clips';

type Show = 'all' | 'v3' | 'v2';
const FILTERS: { id: Show; label: string }[] = [{ id: 'all', label: LIBRARY.filters[0] }, { id: 'v3', label: LIBRARY.filters[1] }, { id: 'v2', label: LIBRARY.filters[2] }];
const chip = (on: boolean) => ({ height: 36, padding: '0 14px', borderRadius: 999, border: `1px solid ${on ? 'var(--ink)' : '#E0E0E4'}`, background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', font: '500 13px var(--font)', cursor: 'pointer' }) as const;
const days = (at: number, now = Date.now()) => Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);

const open = (id: string) => { void send({ type: 'editor/open', clipId: id }); };

/** v2 clips keep their look; v3 and restyled clips are "v3". */
const shownIn = (kind: ClipKind, show: Show) => show === 'all' || (show === 'v2' ? kind === 'v2' : kind !== 'v2');

/** LibraryV3: your clips; a v2 clip says "v2 look" and offers "Restyle with v3 motion". */
export default function LibraryV3() {
  const { replace } = useRouter();
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [show, setShow] = useState<Show>('all');
  const reload = useCallback(() => {
    listClips().then((all) => setClips(sortClips(all))).catch((error: unknown) => { console.error('Motikord: could not list your clips', error); setClips((c) => c ?? []); });
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => onMessage({ 'clip/saved': () => { reload(); } }), [reload]);
  const list = useMemo(() => (clips ?? []).filter((c) => shownIn(clipKind(c), show)), [clips, show]);

  if (clips === null) return <main data-frame="LibraryV3" style={{ flexGrow: 1 }} />;
  if (clips.length === 0) return <LibraryEmpty />;
  return (
    <main data-frame="LibraryV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0 20px' }}>
        <BackButton onBack={() => replace('HomeV3')} />
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', flexGrow: 1 }}>{LIBRARY.title}</h1>
        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', paddingRight: 8 }}>{LIBRARY.count(clips.length)}</span>
      </div>
      <div role="group" aria-label={LIBRARY.show} style={{ display: 'flex', gap: 6, padding: '12px 16px 0' }}>
        {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={show === f.id} style={chip(show === f.id)} onClick={() => setShow(f.id)}>{f.label}</button>)}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((c) => {
          const kind = clipKind(c);
          return (
            <li key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <span aria-hidden="true" style={{ flexShrink: 0, width: 60, borderRadius: 10, overflow: 'hidden', boxShadow: '0 10px 18px -12px rgba(17,17,17,0.5)' }}><RecipeThumb recipe={c.recipe} height={106} /></span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
                <button type="button" aria-label={`Open ${c.recipe.name}`} onClick={() => open(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 24, border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.recipe.name}</span>
                  {kind === 'v2' && <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', background: '#F1F1F4', padding: '2px 7px', borderRadius: 999, flexShrink: 0 }}>{LIBRARY.v2}</span>}
                </button>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{seconds(clipDuration(c.recipe))} · {formatBytes(clipRowBytes([c]))} · {packNameOf(c)}</span>
                {kind === 'restyled'
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--success-ink)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>{LIBRARY.restyled}</span>
                  : kind !== 'v2' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{LIBRARY.edited(days(c.updatedAt))}</span>}
                {kind === 'v2' && (
                  <button type="button" onClick={() => open(c.id)} style={{ marginTop: 4, alignSelf: 'flex-start', height: 36, padding: '0 12px', borderRadius: 10, border: '1px solid #F9A8D4', background: 'var(--tint)', color: 'var(--accent-hover)', font: '600 13px var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>{LIBRARY.restyle}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <p style={{ margin: '14px 24px 16px', fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{LIBRARY.footer}</p>
    </main>
  );
}
