import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useRouter } from '../router';
import { getRecording, updateRecording } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import { isModelCached } from '@/lib/transcribe/cache';
import { retranscribedPatch } from '@/lib/transcribe/full';
import { downloadModel } from '@/lib/transcribe/download';
import { megabytes } from '@/lib/transcribe/whisper';
import { startNotes } from '@/lib/notes/summarize';
import { run, type Job } from '../components/Retranscribe';
import type { Recording, Segment } from '@/lib/types';
import { currentLine, transcriptItems, transcriptText } from '@/lib/comments';
import { MARKER_LABEL } from '@/lib/markers';
import { formatClock } from '@/lib/time';
import type { ReviewContext } from '../components/Player';

const MONO = "var(--mono, 'Geist Mono', monospace)";

export const transcriptTab = ({ rec, now, seek, setRec }: ReviewContext) => <Transcript rec={rec} now={now} seek={seek} setRec={setRec} />;

export interface MakeDeps {
  asked: () => Promise<unknown>;
  cached: () => Promise<boolean>;
  download: (job: Job, onBytes: (loaded: number, total: number) => void) => Promise<void>;
  write: (rec: Recording, job: Job, onPct: (pct: number) => void) => Promise<Segment[] | null>;
  save: (id: string, patch: Partial<Recording>) => Promise<unknown>;
}

/** Make transcript: allows the download from now on, fetches the model once if needed, then retranscribes. True when saved. */
export async function makeTranscript(
  rec: Recording, job: Job, deps: MakeDeps,
  on: { onStep: (step: 'download' | 'write') => void; onBytes: (loaded: number, total: number) => void; onPct: (pct: number) => void },
): Promise<boolean> {
  await deps.asked();
  if (!(await deps.cached())) {
    on.onStep('download');
    await deps.download(job, on.onBytes);
  }
  if (job.stopped) return false;
  on.onStep('write');
  const segs = await deps.write(rec, job, on.onPct);
  if (job.stopped || !segs) return false;
  await deps.save(rec.id, { ...retranscribedPatch(segs), transcriptDeferred: false });
  return true;
}

const realDeps: MakeDeps = {
  asked: () => updateSettings({ localModelAsked: true }),
  cached: () => isModelCached(),
  download: downloadModel,
  write: run,
  save: (id, patch) => updateRecording(id, patch),
};

const card: CSSProperties = { padding: '20px 16px', borderRadius: 16, background: '#FFFFFF', border: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', gap: 10 };
const btn: CSSProperties = { height: 44, borderRadius: 12, font: 'inherit', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' };
const primaryBtn: CSSProperties = { ...btn, marginTop: 6, border: 'none', background: '#C2410C', color: '#FFFFFF', cursor: 'pointer' };
const quietBtn: CSSProperties = { ...btn, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114', fontWeight: 500, cursor: 'pointer' };

const Step = ({ now, children }: { now: boolean; children: ReactNode }) => (
  <li style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: now ? 600 : 400, color: now ? '#111114' : '#6E7079' }}>
    <span style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${now ? '#C2410C' : '#DCDCE0'}`, boxSizing: 'border-box', flexShrink: 0 }} />
    {children}
  </li>
);

type Make = { phase: 'idle' } | { phase: 'failed' } | { phase: 'making'; step: 'download' | 'write'; loaded: number; total: number; pct: number };

/** The ReviewMakeTranscript, ReviewMakingTranscript and make-transcript states: shown when the video was saved with no transcript. */
export function MakeTranscript({ rec, onDone, deps = realDeps }: { rec: Recording; onDone: (rec: Recording) => void; deps?: MakeDeps }) {
  const { navigate } = useRouter();
  const [state, setState] = useState<Make>({ phase: 'idle' });
  const [online, setOnline] = useState(() => navigator.onLine);
  const job = useRef<Job | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      if (job.current) {
        job.current.stopped = true;
        job.current.stop();
      }
    };
  }, []);

  async function start() {
    const j: Job = { stop: () => undefined, stopped: false };
    job.current = j;
    setState({ phase: 'making', step: 'download', loaded: 0, total: 0, pct: 0 });
    try {
      const saved = await makeTranscript(rec, j, deps, {
        onStep: (step) => !j.stopped && setState((s) => (s.phase === 'making' ? { ...s, step } : s)),
        onBytes: (loaded, total) => !j.stopped && setState((s) => (s.phase === 'making' ? { ...s, loaded, total } : s)),
        onPct: (pct) => !j.stopped && setState((s) => (s.phase === 'making' ? { ...s, pct } : s)),
      });
      if (saved) {
        void startNotes(rec.id); // The transcript now exists, so the notes can be written.
        onDone((await getRecording(rec.id)) ?? rec);
      }
    } catch (error) {
      if (!j.stopped) {
        console.error('Klipkord: could not make the transcript', error);
        setState({ phase: 'failed' });
      }
    } finally {
      if (job.current === j) job.current = null;
    }
  }

  function cancel() {
    const j = job.current;
    if (j) {
      j.stopped = true;
      j.stop();
      job.current = null;
    }
    setState({ phase: 'idle' });
  }

  if (state.phase === 'making') {
    const downloading = state.step === 'download';
    const value = downloading ? (state.total ? Math.floor((state.loaded / state.total) * 100) : 0) : state.pct;
    return (
      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ ...card, gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Making your transcript</span>
          <div role="progressbar" aria-label="Downloading the model" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} style={{ height: 8, borderRadius: 999, background: '#EBEBEE', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${value}%`, height: '100%', borderRadius: 999, background: '#C2410C' }} />
          </div>
          {downloading && <span style={{ fontSize: 13, color: '#5F6168' }}>Downloading the model · {megabytes(state.loaded)} of {megabytes(state.total)} MB</span>}
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Step now={downloading}>Download model once</Step>
            <Step now={!downloading}>Write transcript</Step>
          </ol>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079' }}>You can keep watching. The transcript appears here when it is ready.</span>
          <button type="button" style={quietBtn} onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  if (state.phase === 'failed') {
    return (
      <div style={{ padding: '16px 16px 0' }}>
        <div style={card}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>The download stopped</span>
          <span style={{ fontSize: 13, lineHeight: 1.5, color: '#5F6168' }}>Your connection dropped. Your video is safe. Try again when you are back online.</span>
          <button type="button" style={primaryBtn} onClick={() => void start()}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={card}>
        {online ? (
          <>
            <span style={{ fontSize: 16, fontWeight: 600 }}>No transcript yet</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: '#5F6168' }}>No AI was set up, so your video was saved without one. Make transcript downloads a small model to this computer once and writes it. Nothing from the recording is sent.</span>
            <button type="button" style={primaryBtn} onClick={() => void start()}>Make transcript</button>
          </>
        ) : (
          <>
            <span style={{ fontSize: 16, fontWeight: 600 }}>You're offline</span>
            <span style={{ fontSize: 13, lineHeight: 1.5, color: '#5F6168' }}>Making a transcript needs a connection once, to download the model. Your video is safe and plays as normal.</span>
            <button type="button" disabled style={{ ...primaryBtn, opacity: 0.4, cursor: 'default' }}>Make transcript</button>
            <span style={{ fontSize: 12, color: '#6E7079' }}>Available again when you are back online.</span>
          </>
        )}
        <button type="button" onClick={() => navigate('Settings')}
          style={{ alignSelf: 'center', border: 'none', background: 'none', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#C2410C', padding: 14, minHeight: 44, cursor: 'pointer' }}>Use a cloud model instead</button>
      </div>
    </div>
  );
}

function Transcript({ rec: first, now, seek, setRec }: { rec: Recording; now: number; seek: (ms: number) => void; setRec?: (rec: Recording) => void }) {
  const [made, setMade] = useState<Recording | null>(null);
  const rec = made ?? first;
  if (rec.transcriptDeferred) return <MakeTranscript rec={rec} onDone={(r) => { setMade(r); setRec?.(r); }} />;
  return <Lines rec={rec} now={now} seek={seek} />;
}

function Lines({ rec, now, seek }: { rec: Recording; now: number; seek: (ms: number) => void }) {
  const current = currentLine(rec.transcript, now);
  const items = transcriptItems(rec.transcript, rec.markers, rec.notes);
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => { active.current?.scrollIntoView?.({ block: 'nearest' }); }, [current]);

  function copyAll() {
    navigator.clipboard.writeText(transcriptText(rec.transcript, formatClock)).catch((error) => console.error('Klipkord: could not copy the transcript', error));
  }

  return (
    <>
      <div style={{ padding: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#6E7079' }}>Click a line to jump there.</span>
        <button type="button" onClick={copyAll}
          style={{ height: 32, padding: '0 10px', border: '1px solid #E8E8EB', borderRadius: 8, background: '#FFFFFF', font: 'inherit', fontSize: 12, fontWeight: 500, color: '#111114', cursor: 'pointer' }}>Copy all</button>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflow: 'auto', padding: '8px 8px 16px', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14, lineHeight: 1.5 }}>
        {items.map((item) => {
          if (item.kind === 'line') {
            const on = item.index === current;
            return (
              <button key={`l${item.index}`} ref={on ? active : undefined} type="button" aria-current={on ? 'true' : undefined} onClick={() => seek(item.segment.start)}
                style={{ padding: 8, border: 'none', borderRadius: 10, background: on ? '#FFF1EA' : 'none', color: '#111114', font: 'inherit', textAlign: 'left', cursor: 'pointer', display: 'flex', gap: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 12, color: on ? '#9A3412' : '#6E7079', paddingTop: 2, flexShrink: 0 }}>{formatClock(item.segment.start)}</span>
                <span>{item.segment.text}</span>
              </button>
            );
          }
          if (item.kind === 'marker') {
            return (
              <button key={`m${item.marker.id}`} type="button" onClick={() => seek(item.at)}
                style={{ padding: '4px 8px 4px 60px', border: 'none', background: 'none', font: 'inherit', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ padding: '3px 8px', borderRadius: 999, background: '#FFF1EA', color: '#9A3412', fontSize: 12, fontWeight: 600 }}>{MARKER_LABEL[item.marker.kind]}</span>
                <span style={{ fontFamily: MONO, fontSize: 12, color: '#6E7079' }}>{formatClock(item.at)}</span>
              </button>
            );
          }
          return (
            <button key={`n${item.note.id}`} type="button" onClick={() => seek(item.at)}
              style={{ margin: '2px 8px 2px 60px', padding: '8px 10px', borderRadius: 10, background: '#FFFFFF', border: '1px solid #E8E8EB', font: 'inherit', fontSize: 13, color: '#111114', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6E7079' }}>Your note · {formatClock(item.at)}</span>
              {item.note.text}
            </button>
          );
        })}
      </div>
    </>
  );
}
