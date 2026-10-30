import { useEffect, useState } from 'react';
import { IconButton } from '../components/ui';
import { creditsList, creditsText, endCardEdit, endCardLines, type CreditRow } from '../lib/credits';
import { getMedia } from '../lib/media';
import type { Asset } from '../lib/types';
import { CloseIcon, DialogShell, useStoredClip } from './MediaSearch';

const swatch = { width: 36, height: 36, borderRadius: 6, flexShrink: 0, background: 'var(--stage)', display: 'grid', placeItems: 'center' } as const;

function Thumb({ asset }: { asset: Asset }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (asset.kind !== 'image') return;
    let url: string | undefined;
    let live = true;
    void getMedia(asset.opfsPath).then((f) => { if (f && live) { url = URL.createObjectURL(f); setSrc(url); } }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [asset]);
  if (src) return <span role="img" aria-label="" style={{ ...swatch, background: `url("${src}") center / cover` }} />;
  return (
    <span style={{ ...swatch, background: asset.kind === 'audio' ? '#EEF2FF' : 'var(--stage)' }} aria-hidden="true">
      {asset.kind === 'audio' && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3730A3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>}
    </span>
  );
}

export function Item({ row }: { row: CreditRow }) {
  const { asset, credit, source, licence, need } = row;
  const page = credit.licence === 'page';
  const line = credit.source === 'bundled' ? `Comes with Motikord · ${licence}` : page ? `From ${credit.author}` : `${credit.author} · ${source} · ${licence}`;
  return (
    <li style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--line)' }}>
      <Thumb asset={asset} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{credit.title}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{line}</span>
        {page && <span style={{ fontSize: 12, color: 'var(--warning-ink)' }}>Check you may use it.</span>}
      </span>
      {need === 'needed'
        ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--warning-ink)', background: '#FEF3C7', padding: '2px 8px', borderRadius: 999 }}>Credit needed</span>
        : <span style={{ fontSize: 11, color: 'var(--muted)' }}>Credit optional</span>}
    </li>
  );
}

/** Credits dialog: who made what, the credits.txt text, and the end card switch. */
export default function Credits() {
  const { recipe, commit, close } = useStoredClip();
  if (!recipe) return <DialogShell width={560} label="Credits" style={{ padding: '18px 20px' }}><span role="status" style={{ fontSize: 13, color: 'var(--muted)' }}>Credits</span></DialogShell>;
  const { credited, own } = creditsList(recipe);
  const lines = endCardLines(recipe);
  return (
    <DialogShell width={560} label="Credits" style={{ padding: '18px 20px', gap: 14, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Credits</h1>
        <IconButton aria-label="Close" onClick={close}><CloseIcon /></IconButton>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Everything in this clip that someone else made. Saved as credits.txt next to your video.</p>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {credited.map((row) => <Item key={row.asset.id} row={row} />)}
        {own.length > 0 && (
          <li style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderTop: credited.length ? '1px solid var(--line)' : 0 }}>
            <span style={{ ...swatch, background: '#F4F4F5' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{own.map((a) => a.name).join(', ')}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Your own media</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Not listed</span>
          </li>
        )}
      </ul>

      <div style={{ display: 'flex', gap: 14 }}>
        <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>credits.txt</span>
          <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--ground)', fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.55, color: '#2A2B30', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{creditsText(recipe)}</pre>
        </div>
        <div style={{ width: 120, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>End card</span>
          <span style={{ height: 213, borderRadius: 8, background: 'var(--ink)', color: '#E4E4E7', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 8, lineHeight: 1.4, overflow: 'hidden' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#fff' }}>Credits</span>
            {lines.map((l) => <span key={l}>{l}</span>)}
          </span>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)' }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Add an end card with these credits</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>2 seconds at the end of the clip</span>
        </span>
        <input type="checkbox" role="switch" checked={!!recipe.creditsEndCard} onChange={(e) => void commit(endCardEdit(recipe, e.target.checked))} style={{ accentColor: 'var(--accent)', margin: 0, width: 18, height: 18 }} />
      </label>
      <span style={{ fontSize: 12, color: 'var(--faint)' }}>Clips with CC BY media always export with credits.txt.</span>
    </DialogShell>
  );
}
