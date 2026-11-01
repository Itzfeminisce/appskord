import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from '../entrypoints/editor/router';
import { getClip, getExportJob } from '../lib/db';
import { cancelExport, getSession, jobChoice, subscribe, type Session } from '../lib/exportJob';
import { frameClock, timeLeft } from '../lib/exportPlan';
import { savedFolder } from '../lib/folder';
import type { Aspect } from '../lib/types';
import { DialogShell } from './MediaSearch';
import { beginExport, folderFromClick, openExportAs } from './Export';
import { DiskFull, ExportFailed, ExportingSeveral, ExportSlow, SeeThroughFailed } from './StatesExport';

const PREVIEW: Record<Aspect, { w: number; h: number }> = { '9:16': { w: 180, h: 320 }, '1:1': { w: 260, h: 260 }, '16:9': { w: 400, h: 225 } };
const note = { display: 'flex', gap: 8, alignItems: 'flex-start' } as const;

const restarted = new Set<string>();
export const useSession = () => useSyncExternalStore(subscribe, getSession);

function Preview({ s }: { s: Session }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const item = s.items[s.index]!.item;
  const size = PREVIEW[item.aspect];
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    // Keep the last frame on screen once the run ends and its bitmap is freed.
    if (!c || !g || !s.preview) return;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(s.preview, 0, 0, c.width, c.height);
  }, [s.preview]);
  const checker = item.seeThrough ? 'repeating-conic-gradient(#E4E4E7 0% 25%, #FFFFFF 0% 50%) 50% / 16px 16px' : 'var(--tint-strong)';
  return (
    <div style={{ alignSelf: 'center', position: 'relative', width: size.w, height: size.h, background: checker, overflow: 'hidden', boxShadow: '0 6px 20px rgba(16,16,20,0.12)', flexShrink: 0 }}>
      <canvas ref={ref} width={size.w * 2} height={size.h * 2} style={{ width: '100%', height: '100%', display: 'block' }} aria-label={s.recipe.name} role="img" />
      <span style={{ position: 'absolute', right: 8, top: 8, padding: '2px 6px', borderRadius: 5, background: 'rgba(17,17,20,0.75)', color: '#fff', fontFamily: 'var(--mono)', fontSize: 10 }}>{frameClock(s.tMs)}</span>
    </div>
  );
}

/** Exporting: the frame being made, progress, frames and time left; Cancel stops it and removes partial files. */
export default function Rendering() {
  const { route, navigate, replace } = useRouter();
  const s = useSession();
  const [missing, setMissing] = useState(false);
  const clipId = route.params.clipId ?? s?.job.clipId;

  // From Recovered: ?export=<job id> restarts that job with the same choices.
  useEffect(() => {
    const jobId = new URLSearchParams(location.search).get('export');
    if (getSession() || !jobId) { if (!getSession()) setMissing(true); return; }
    if (restarted.has(jobId)) return;
    restarted.add(jobId);
    (async () => {
      const job = await getExportJob(jobId);
      const clip = job && await getClip(job.clipId);
      if (!job || !clip) { setMissing(true); return; }
      const root = await savedFolder(false).catch(() => undefined);
      if (!root) { navigate('Export', { clipId: clip.id }); return; }
      beginExport(clip.recipe, clip.id, jobChoice(job), root, job.id);
    })().catch((error: unknown) => { console.error('Motikord: could not restart the export', error); setMissing(true); });
  }, [navigate]);

  useEffect(() => {
    if (!s) return;
    if (s.phase === 'done') replace('Exported', { clipId: s.job.clipId });
    else if (s.phase === 'cancelled' || s.phase === 'access-lost') replace('Export', { clipId: s.job.clipId });
  }, [s?.phase, s, replace]);

  useEffect(() => {
    if (missing && !getSession()) replace('Export', { clipId });
  }, [missing, clipId, replace]);

  if (!s || !s.items.length) return <DialogShell width={560} label="Rendering" style={{ padding: '18px 20px' }}><h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Exporting</h1></DialogShell>;

  const cur = s.items[s.index]!;
  const itemPercent = Math.floor(cur.status === 'done' ? 100 : (s.frame / Math.max(1, s.frames)) * 100);
  const again = async () => {
    const root = await folderFromClick().catch(() => undefined);
    if (!root) { replace('Export', { clipId: s.job.clipId }); return; }
    beginExport(s.recipe, s.job.clipId, jobChoice(s.job), root);
  };
  const asWebm = () => { openExportAs('webm'); replace('Export', { clipId: s.job.clipId }); };

  return (
    <DialogShell width={560} label="Rendering" style={{ padding: '18px 20px 20px', gap: 14, overflowY: 'auto' }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Exporting</h1>
      <Preview s={s} />

      {s.phase === 'running' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontSize: 15, fontWeight: 600 }}>{cur.item.label}</span><span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{`${itemPercent}%`}</span></div>
          <span role="progressbar" aria-valuenow={itemPercent} aria-valuemin={0} aria-valuemax={100} style={{ height: 8, borderRadius: 4, background: '#F1F1F3', overflow: 'hidden' }}><span style={{ display: 'block', width: `${itemPercent}%`, height: '100%', background: 'var(--accent)' }} /></span>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>{`Frame ${s.frame} of ${s.frames}`}</span>{s.frame > 0 && <span>{timeLeft(s.secondsLeft)}</span>}</div>
        </div>
      )}
      {s.phase === 'disk-full' && <DiskFull percent={s.percent} onAgain={() => void again()} />}
      {s.phase === 'failed' && (s.failedKind === 'webm-alpha'
        ? <SeeThroughFailed onWebm={asWebm} onBack={() => replace('Export', { clipId: s.job.clipId })} />
        : <ExportFailed onRetry={() => void again()} onWebm={asWebm} />)}

      {s.items.length > 1 && s.phase === 'running' && (
        <ExportingSeveral index={s.index} rows={s.items.map((it) => ({ label: s.items.filter((o) => o.item.aspect === it.item.aspect).length > 1 ? it.item.label : it.item.aspect, status: it.status, percent: it.percent }))} />
      )}
      {s.phase === 'running' && s.hardware === false && <ExportSlow />}

      {s.phase === 'running' && (
        <ul style={{ listStyle: 'none', margin: 0, padding: '10px 12px', borderRadius: 10, background: 'var(--ground)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, lineHeight: 1.45, color: '#44464D' }}>
          {s.hardware && <li style={note}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>Using this computer’s video chip, so it’s fast.</li>}
          <li style={note}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /></svg>Keep this tab open. You can use other tabs; exporting may be a little slower.</li>
        </ul>
      )}

      <div style={{ flexGrow: 1 }} />
      {s.phase === 'running' && (
        <>
          <button type="button" className="btn btn-secondary btn-block" onClick={cancelExport} style={{ height: 44, borderRadius: 12, flexShrink: 0 }}><span className="btn-label">Cancel</span></button>
          <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)', marginTop: -4 }}>Your clip is safe. Cancelling only stops this export.</span>
        </>
      )}
    </DialogShell>
  );
}
