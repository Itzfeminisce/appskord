import { useEffect, useState } from 'react';
import { getFolderHandle, getRecording, listRecordings } from '@/lib/db';
import { whenLabel } from '@/lib/library';
import { fromRecording } from '@/lib/project/migrate';
import { getProject } from '@/lib/project/store';
import { quickWins as findQuickWins } from '@/lib/project/suggest';
import { readSizes } from '@/lib/folder';
import { formatBytes } from '@/lib/time';
import type { Recording } from '@/lib/types';
import { clock } from '../../editor/format';
import { countClicks } from '../../editor/media';
import { openEditor } from '../../editor/open';
import { loadEvents } from '../../editor/transcript/events';
import { QUICK_WINS_KEY } from '../../editor/transcript/store';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { BackBar } from './Export';

const MONO = "var(--mono, 'Geist Mono', monospace)";

export default function Saved() {
  const { route, replace } = useRouter();
  const id = route.params.recordingId;
  const [rec, setRec] = useState<Recording | null | undefined>();
  const [sizes, setSizes] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!id) return setRec(null);
    getRecording(id).then(async (r) => {
      setRec(r ?? null);
      const files = r?.savedTo?.files ?? [];
      const handle = await getFolderHandle();
      if (handle && files.length) setSizes(await readSizes(handle, files));
    }).catch((error) => { console.error('Klipkord: could not load the saved files', error); setRec((r) => r ?? null); });
  }, [id]);

  if (rec === undefined) return <main className="screen screen-center"><Spinner label="Loading" /></main>;
  if (rec?.v3) return <PanelOpen rec={rec} />;
  const saved = rec?.savedTo;
  const sub = saved?.files[0]?.split('/')[0];
  const goReview = () => replace('Review', { recordingId: id });

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <BackBar label="Back" onBack={goReview} />
      <div style={{ padding: '48px 24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
        <span style={{ width: 72, height: 72, borderRadius: '50%', background: '#ECFDF3', color: '#15803D', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
        </span>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>Saved to your folder</h1>
        {saved && <p style={{ margin: 0, maxWidth: 300, fontSize: 14, lineHeight: 1.5, color: '#5F6168' }}>Find it in {saved.folder}{sub ? ` › ${sub}` : ''}.</p>}
      </div>

      {saved && (
        <div style={{ margin: '28px 24px 0', padding: '4px 14px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column' }}>
          {saved.files.map((path, i) => (
            <div key={path} style={{ borderTop: i ? '1px solid #EFEFF1' : undefined, padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, wordBreak: 'break-all' }}>{path.split('/').pop()}</span>
              <span style={{ color: '#6E7079', fontSize: 13, flexShrink: 0 }}>{sizes[path] !== undefined ? formatBytes(sizes[path]!) : ''}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ margin: '12px 24px 0', padding: '12px 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>
        To share it, send the video file or drop it into any chat or drive you already use.
      </div>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => replace('Home')} style={{ height: 48, border: 'none', borderRadius: 12, background: '#111114', color: '#FFFFFF', font: 'inherit', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>New recording</button>
        <button type="button" onClick={goReview} style={{ height: 44, border: 'none', borderRadius: 12, background: 'transparent', color: '#44464D', font: 'inherit', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Back to this recording</button>
      </div>
    </main>
  );
}

const PANEL_TRACKS: Partial<Record<string, string>> = { screen: 'Screen', camera: 'camera', mic: 'voice' };

/** "Screen, camera and voice saved as separate tracks." from the tracks the recording has. */
export function tracksLine(sources: string[]): string | null {
  const names = sources.flatMap((s) => PANEL_TRACKS[s] ?? []);
  if (names.length < 2) return null;
  const list = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} saved as separate tracks.`;
}

const editorTab = (id: string) => void openEditor(id).catch((error) => console.error('Klipkord: could not open the editor', error));

/** The card opens SuggestedEdits again, even after "Not now": the editor tab picks the ask up. */
function openQuickWins(id: string) {
  try {
    localStorage.setItem(QUICK_WINS_KEY, id);
  } catch (error) {
    console.error('Klipkord: could not ask for the quick wins', error);
  }
  editorTab(id);
}

function PanelThumb({ blob, length }: { blob?: Blob; length: number }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div style={{ margin: '12px 16px 0', height: 200, borderRadius: 14, background: 'linear-gradient(135deg, #7C2D12, #C2410C 55%, #FDBA74)', position: 'relative', overflow: 'hidden' }}>
      {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <span style={{ position: 'absolute', left: 12, bottom: 12, padding: '4px 8px', borderRadius: 6, background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', fontFamily: MONO, fontSize: 12 }}>{clock(length)}</span>
    </div>
  );
}

interface Row { rec: Recording; cuts: number }

/** PanelOpen: Saved for a v3 recording, with the way into the editor and the latest recordings. */
function PanelOpen({ rec }: { rec: Recording }) {
  const { navigate } = useRouter();
  const [clicks, setClicks] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [quickWins, setQuickWins] = useState<number>();

  useEffect(() => {
    if (rec.v3?.events) void countClicks(rec.id).then(setClicks);
    (async () => {
      const project = (await getProject(rec.id)) ?? fromRecording(rec);
      const events = project.events ? await loadEvents(rec.id) : undefined;
      setQuickWins(findQuickWins(project, rec.transcript, events, rec.duration).length);
    })().catch((error) => console.error('Klipkord: could not find the quick wins', error));
    listRecordings().then(async (all) => {
      const recent = all.filter((r) => r.status === 'ready').sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
      setRows(await Promise.all(recent.map(async (r) => ({ rec: r, cuts: (await getProject(r.id))?.cuts.length ?? 1 }))));
    }).catch((error) => console.error('Klipkord: could not list the recordings', error));
  }, [rec]);

  const saved = rec.savedTo;
  const sub = saved?.files[0]?.split('/')[0];
  const line = [tracksLine(rec.v3?.sources ?? []), clicks > 0 ? `${clicks} ${clicks === 1 ? 'click' : 'clicks'} recorded.` : null].filter(Boolean).join(' ');
  const now = Date.now();

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 0', gap: 8 }}><h1 style={{ margin: 0, flexGrow: 1, fontSize: 16, fontWeight: 600 }}>Saved</h1></div>
      <PanelThumb blob={rec.thumbnail} length={rec.duration} />
      <div style={{ margin: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{rec.title}</span>
        {line && <span style={{ fontSize: 13, color: '#5F6168' }}>{line}</span>}
        {/* Saved is also where Export lands after writing to the folder. */}
        {saved && <span style={{ fontSize: 13, color: '#5F6168' }}>Find it in {saved.folder}{sub ? ` › ${sub}` : ''}.</span>}
      </div>
      <div style={{ margin: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => editorTab(rec.id)} style={{ height: 44, borderRadius: 12, background: '#C2410C', color: '#FFFFFF', border: 0, font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Open in the editor</button>
        <button type="button" onClick={() => navigate('Trim', { recordingId: rec.id })} style={{ height: 44, borderRadius: 12, background: '#FFFFFF', color: '#111114', border: '1px solid #E8E8EB', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Quick trim here</button>
      </div>
      {!!quickWins && (
        <button type="button" onClick={() => openQuickWins(rec.id)} style={{ margin: '12px 16px 0', padding: 12, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114', font: 'inherit', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{`${quickWins} ${quickWins === 1 ? 'quick win' : 'quick wins'} found`}</span>
          <span style={{ fontSize: 12.5, color: '#5F6168', lineHeight: 1.45 }}>Fillers, a retake, long pauses and zooms. They wait for you in the editor.</span>
        </button>
      )}
      {rows.length > 0 && (
        <>
          <div style={{ margin: '22px 16px 0', fontSize: 12, fontWeight: 600, color: '#5F6168' }}>Library</div>
          <div style={{ margin: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(({ rec: r, cuts }) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12, background: '#FFFFFF', border: '1px solid #E8E8EB' }}>
                <span style={{ width: 72, height: 40, borderRadius: 6, background: 'linear-gradient(135deg, #7C2D12, #C2410C)', flexShrink: 0 }} />
                <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{r.title}</span>
                  <span style={{ fontSize: 12, color: '#5F6168' }}>{rowMeta(r, cuts, now)}</span>
                </span>
                <button type="button" onClick={() => editorTab(r.id)} style={{ height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
              </div>
            ))}
          </div>
        </>
      )}
      <p style={{ margin: '10px 16px 16px', fontSize: 12, color: '#5F6168' }}>The editor opens in a new tab. Recording stays here in the side panel.</p>
    </main>
  );
}

/** "Today · 6:42 · 3 cuts", and "camera baked in" for recordings made before v3. */
export function rowMeta(r: Recording, cuts: number, now: number): string {
  return [whenLabel(r.createdAt, now), clock(r.duration), cuts > 1 ? `${cuts} cuts` : null, r.v3 ? null : 'camera baked in'].filter(Boolean).join(' · ');
}
