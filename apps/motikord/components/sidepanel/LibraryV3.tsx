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
const chip = (on: boolean) => ({ height: 28, padding: '0 12px', borderRadius: 999, border: on ? 0 : '1px solid #E0E0E4', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', font: '12px var(--font)', cursor: 'pointer' }) as const;
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '16px 16px 0' }}>
        <BackButton onBack={() => replace('HomeV3')} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, flexGrow: 1 }}>{LIBRARY.title}</h1>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{LIBRARY.count(clips.length)}</span>
      </div>
      <div role="group" aria-label={LIBRARY.show} style={{ display: 'flex', gap: 6, padding: '12px 16px 0' }}>
        {FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={show === f.id} style={chip(show === f.id)} onClick={() => setShow(f.id)}>{f.label}</button>)}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((c) => {
          const kind = clipKind(c);
          return (
            <li key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <button type="button" aria-label={`Open ${c.recipe.name}`} onClick={() => open(c.id)} style={{ display: 'flex', gap: 12, alignItems: 'center', border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ flexShrink: 0, width: 44 }}><RecipeThumb recipe={c.recipe} height={78} /></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.recipe.name}</span>
                    {kind === 'v2' && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', background: '#F1F1F3', padding: '2px 8px', borderRadius: 999, flexShrink: 0 }}>{LIBRARY.v2}</span>}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{seconds(clipDuration(c.recipe))} · {formatBytes(clipRowBytes([c]))} · {packNameOf(c)}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint)' }}>{kind === 'restyled' ? LIBRARY.restyled : LIBRARY.edited(days(c.updatedAt))}</span>
                </span>
              </button>
              {kind === 'v2' && (
                <button type="button" onClick={() => open(c.id)} style={{ height: 34, borderRadius: 9, border: '1px solid #F9A8D4', background: 'var(--surface)', color: 'var(--accent-hover)', font: '600 13px var(--font)', cursor: 'pointer' }}>{LIBRARY.restyle}</button>
              )}
            </li>
          );
        })}
      </ul>
      <div style={{ flexGrow: 1 }} />
      <span style={{ padding: '12px 24px 16px', fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{LIBRARY.footer}</span>
    </main>
  );
}
