import { useRef, useState } from 'react';
import { IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { getFolderHandle } from '../lib/db';
import { clearSession } from '../lib/exportJob';
import { ASPECTS, clipClock, formatBytes } from '../lib/exportPlan';
import { CREDITS_FILE, videoFileName } from '../lib/fileNames';
import { CloseIcon, DialogShell, useSettings } from './MediaSearch';
import { useSession } from './Rendering';

const PLAYER = { '9:16': { w: 180, h: 320 }, '1:1': { w: 260, h: 260 }, '16:9': { w: 400, h: 225 } } as const;
const link = { fontSize: 13, fontWeight: 500, textDecoration: 'none', background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer', font: '500 13px/1.45 var(--font)' } as const;

/** Chrome has no "reveal in folder" for picked folders; its folder picker opened inside the export's sub-folder shows the files. */
async function openFolder(dir: string | undefined) {
  const pick = (globalThis as unknown as { showDirectoryPicker?: (o?: object) => Promise<unknown> }).showDirectoryPicker;
  const root = await getFolderHandle();
  if (!pick || !root) return;
  const startIn = dir ? await root.getDirectoryHandle(dir).catch(() => root) : root;
  await pick({ startIn, id: 'motikord-exports' }).catch((error: { name?: string }) => { if (error?.name !== 'AbortError') throw error; });
}

/** Saved: the player, every file with its size, and where to go next. */
export default function Exported() {
  const { route, replace } = useRouter();
  const s = useSession();
  const settings = useSettings();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const clipId = route.params.clipId ?? s?.job.clipId;
  const first = s?.items[0]?.item;
  const size = PLAYER[first?.aspect ?? ASPECTS[0]!];
  const gif = first?.kind === 'gif';
  const folder = settings?.folderName ?? 'Motikord clips';
  // The real name this clip's see-through file has (or would have), so the note never shows sample data.
  const seeThroughName = s ? (s.items.find((it) => it.item.kind === 'webm-alpha')?.item.file ?? videoFileName(s.recipe.name, first?.aspect ?? s.recipe.aspect, 'webm-alpha')) : '';
  const byName = new Map(s?.items.map((it) => [it.item.file, it.item]) ?? []);

  const play = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) { void v.play().then(() => setPlaying(true)).catch((error: unknown) => console.error('Motikord: could not play the video', error)); }
    else { v.pause(); setPlaying(false); }
  };
  const again = () => { clearSession(); replace('Export', { clipId }); };
  const editing = () => { clearSession(); replace('Editor', { clipId }); };
  const newClip = () => {
    void browser.windows.getCurrent().then((w) => browser.sidePanel.open({ windowId: w.id! }))
      .catch((error: unknown) => console.error('Motikord: could not open the side panel', error));
  };

  return (
    <DialogShell width={560} label="Exported" style={{ padding: '18px 20px 20px', gap: 14, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          {`Saved to ${folder}`}
        </h1>
        <IconButton aria-label="Close" onClick={editing}><CloseIcon /></IconButton>
      </div>

      {s?.playUrl && (
        <div style={{ alignSelf: 'center', position: 'relative', width: size.w, height: size.h, background: first?.seeThrough ? 'repeating-conic-gradient(#E4E4E7 0% 25%, #FFFFFF 0% 50%) 50% / 16px 16px' : 'var(--tint-strong)', overflow: 'hidden', boxShadow: '0 6px 20px rgba(16,16,20,0.12)', flexShrink: 0 }}>
          {gif
            ? <img src={s.playUrl} alt={s.recipe.name} style={{ width: '100%', height: '100%', display: 'block' }} />
            : <video ref={video} src={s.playUrl} preload="auto" playsInline onEnded={() => setPlaying(false)} onClick={play} aria-label={s.recipe.name} style={{ width: '100%', height: '100%', display: 'block' }} />}
          {!gif && !playing && (
            <button type="button" aria-label="Play the video" onClick={play} style={{ position: 'absolute', left: '50%', top: '50%', margin: '-24px 0 0 -24px', width: 48, height: 48, border: 0, borderRadius: '50%', background: 'rgba(17,17,20,0.75)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>
            </button>
          )}
        </div>
      )}

      {!!s?.saved.length && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid #EFEFF1', borderRadius: 12, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          {s.saved.map((f, i) => {
            const it = byName.get(f.name);
            return (
              <li key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: i < s.saved.length - 1 ? '1px solid #EFEFF1' : 0 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, flexGrow: 1, overflowWrap: 'anywhere' }}>{f.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{it && f.name !== CREDITS_FILE ? `${formatBytes(f.size)} · ${clipClock(it.durationMs)}` : formatBytes(f.size)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ flexGrow: 1 }} />
      {s && <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)', marginBottom: -4 }}>{`Chrome opens its folder picker inside ${folder}. A see-through file is named ${seeThroughName}.`}</span>}
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button type="button" className="btn btn-primary" onClick={() => void openFolder(s?.dir).catch((error: unknown) => console.error('Motikord: could not show the folder', error))} style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 14 }}><span className="btn-label">Open folder</span></button>
        <button type="button" className="btn btn-secondary" onClick={again} style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 14 }}><span className="btn-label">Export another size</span></button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 20 }}>
        <button type="button" onClick={editing} style={link}>Back to editing</button>
        <button type="button" onClick={newClip} style={link}>Make a new clip</button>
      </div>
    </DialogShell>
  );
}
