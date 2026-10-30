import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { draft, useDraft } from '../lib/makeClip';
import { getMedia } from '../lib/media';
import type { Asset } from '../lib/types';
import { addFiles, describeMedia, displayName, listMedia, type Rejected } from '../lib/yourMedia';
import { BackButton } from './Setup';
import { MediaUnsupported, VideoWontPlay } from './StatesCreate';

const ACCEPT = '.jpg,.jpeg,.png,.svg,.webp,.mp4,.webm,.mov,.mp3,.wav,.ttf,.otf,.woff2';

/** A small picture for pictures and logos; an icon for the rest. */
function Thumb({ asset }: { asset: Asset }) {
  const [url, setUrl] = useState<string>();
  const showsPicture = asset.kind === 'image' || asset.kind === 'logo';
  useEffect(() => {
    if (!showsPicture) return;
    let made: string | undefined;
    let gone = false;
    getMedia(asset.opfsPath).then((f) => { if (f && !gone) { made = URL.createObjectURL(f); setUrl(made); } }).catch((error: unknown) => console.error('Motikord: could not read your file', error));
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [asset.opfsPath, showsPicture]);
  const box = { width: 40, height: 40, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', overflow: 'hidden' } as const;
  if (showsPicture) {
    return (
      <span style={{ ...box, background: asset.kind === 'logo' ? 'var(--surface)' : 'var(--stage)', border: asset.kind === 'logo' ? '1px solid var(--line)' : 0 }}>
        {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: asset.kind === 'logo' ? 'contain' : 'cover' }} />}
      </span>
    );
  }
  if (asset.kind === 'video') return <span style={{ ...box, background: '#3F3F46' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></span>;
  if (asset.kind === 'font') return <span style={{ ...box, background: '#F4F4F5', fontSize: 17, fontWeight: 700 }}>Aa</span>;
  return <span style={{ ...box, background: '#F4F4F5' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg></span>;
}

export default function YourMedia() {
  const { back } = useRouter();
  const attached = useDraft().attached;
  const [items, setItems] = useState<Asset[]>([]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(attached.map((a) => a.id)));
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listMedia().then(setItems).catch((error: unknown) => console.error('Motikord: could not list your media', error));
  }, []);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const { added, rejected: bad } = await addFiles(files);
      setRejected(bad);
      setItems((now) => [...added.reverse(), ...now]);
      setPicked((now) => new Set([...now, ...added.map((a) => a.id)]));
    } catch (error) {
      console.error('Motikord: could not add your files', error);
    } finally {
      setBusy(false);
    }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); void add([...e.dataTransfer.files]); };
  const toggle = (id: string) => setPicked((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next; });
  const use = () => { draft.set({ attached: items.filter((a) => picked.has(a.id)) }); back(); };

  return (
    <main data-frame="YourMedia" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '20px 24px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Your media</h1>
      </div>

      <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        style={{ margin: '12px 16px 0', padding: '22px 16px', borderRadius: 16, border: '2px dashed var(--tint-strong)', borderColor: over ? 'var(--accent)' : '#F9A8D4', background: 'var(--tint)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Drop images, videos, logos, fonts or music</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>JPG, PNG, SVG, WebP, MP4, WebM, MP3, WAV, TTF, OTF, WOFF2</span>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <Button variant="secondary" busy={busy} onClick={() => input.current?.click()} style={{ marginTop: 4, height: 40, padding: '0 18px', fontWeight: 600, fontSize: 13 }}>Choose files</Button>
      </div>
      <span style={{ margin: '8px 20px 0', fontSize: 12, color: 'var(--faint)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        Stays on this computer. Never sent to the AI or any library.
      </span>

      {rejected.length > 0 && (
        <div style={{ margin: '12px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rejected.map((r) => (r.problem === 'video-wont-play' ? <VideoWontPlay key={r.name} name={r.name} /> : <MediaUnsupported key={r.name} name={r.name} />))}
        </div>
      )}

      {items.length > 0 && (
        <div style={{ margin: '16px 16px 0', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
          {items.map((a, i) => (
            <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i ? '1px solid #EFEFF1' : 0, cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} style={{ accentColor: 'var(--accent)', width: 16, height: 16, margin: 0 }} />
              <Thumb asset={a} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(a)}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{describeMedia(a)}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div style={{ marginTop: 'auto', padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button block disabled={picked.size === 0} onClick={use}>Use {picked.size} in my clip</Button>
        <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Everything you add stays here for later clips.</span>
      </div>
    </main>
  );
}
