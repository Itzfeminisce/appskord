import { useEffect, useState } from 'react';
import type { Aspect, FileKind } from '../../lib/types';
import { exportButton } from '../../lib/exportPlan';
import { EXPORT_LINE, FINISHING_LINE } from '../settings/copy';
import { useV3, type Fps } from '../settings/store';
import { StateCard } from '../states/StatesV3';

// ExportV3 (560 px): format, sizes, frame rate, finishing, captions, then the export itself with its progress.

export type ExportKindV3 = FileKind | 'lottie';
export type CaptionsMode = 'burn' | 'srt' | 'off';
export interface ExportChoiceV3 { kind: ExportKindV3; aspects: Aspect[]; fps: Fps; finishing: boolean; captions: CaptionsMode }
export interface ExportProgress { index: number; total: number; aspect: Aspect; frame: number; frames: number; finishing: boolean }

export const EXPORT_COPY = {
  title: 'Export',
  format: 'Format',
  kinds: [
    ['mp4', 'MP4', 'Plays everywhere'],
    ['webm', 'WebM', 'Smaller files, for the web'],
    ['gif', 'GIF', 'Short loops for chats and docs. No sound.'],
    ['webm-alpha', 'Transparent WebM', 'No background, for other editors'],
    ['lottie', 'Lottie', 'Moving vectors for apps and sites'],
  ] as readonly (readonly [ExportKindV3, string, string])[],
  sizes: 'Sizes',
  sizeUse: { '9:16': 'Stories, Reels, Shorts', '1:1': 'Feeds and posts', '16:9': 'YouTube, slides, websites' } as Record<Aspect, string>,
  frameRate: 'Frame rate',
  fps60: '60 fps',
  fps30: '30 fps',
  canDo60: 'This computer can',
  finishing: 'Finishing',
  captions: 'Captions',
  captionsOn: 'Auto captions are on for this clip',
  captionModes: [['burn', 'Burn into the video'], ['srt', 'Separate .srt file'], ['off', 'Off']] as readonly (readonly [CaptionsMode, string])[],
  line: EXPORT_LINE,
  cancel: 'Cancel',
  estimate: (about: string, n: number) => `${about} for ${n} ${n === 1 ? 'size' : 'sizes'} on this computer`,
  exporting: (i: number, n: number) => `Exporting ${i} of ${n}`,
  failed: 'The export stopped before it began. Your clip is safe. Try again.',
  notYet: (kind: ExportKindV3) => `${kind === 'lottie' ? 'Lottie' : 'Transparent WebM'} export from v3 motion is not ready yet. Choose MP4, WebM or GIF.`,
  detail: (aspect: Aspect, frame: number, frames: number, finishing: boolean) => ` · ${aspect} · frame ${frame} of ${frames}${finishing ? ' · Finishing on' : ''}`,
} as const;

const ASPECTS: readonly Aspect[] = ['9:16', '1:1', '16:9'];

/** "About 1 min 20 s": rounded up to 5 s so the guess is not too hopeful. */
export function aboutLine(seconds: number): string {
  const s = Math.ceil(seconds / 5) * 5;
  if (s < 60) return `About ${s} s`;
  return s % 60 ? `About ${Math.floor(s / 60)} min ${s % 60} s` : `About ${s / 60} min`;
}
/** A first guess before the run has measured anything: 60 fps takes about twice as long. */
export const guessSeconds = (clipSeconds: number, sizes: number, fps: Fps) => clipSeconds * sizes * (fps === 60 ? 1.25 : 0.625);

export interface ExportV3Props {
  /** The clip's length, for the time guess. */
  clipSeconds: number;
  /** Auto captions were made for this clip. */
  hasCaptions?: boolean;
  /** Starts the export; without it the button waits. */
  onExport?: (choice: ExportChoiceV3) => void;
  /** Set while a run is going. */
  progress?: ExportProgress;
  onCancel?: () => void;
  onClose?: () => void;
  /** 60 fps would take too long here: shows "Exporting at 30 fps" with "Export at 60 anyway". */
  fallback30?: boolean;
  onExport60Anyway?: () => void;
  /** Why the last Export did not start. */
  notice?: string;
}

export default function ExportV3(p: ExportV3Props) {
  const [v3] = useV3();
  const [kind, setKind] = useState<ExportKindV3>('mp4');
  const [aspects, setAspects] = useState<Aspect[]>(['9:16', '1:1', '16:9']);
  const [fps, setFps] = useState<Fps>(v3.fps);
  const [finishing, setFinishing] = useState(v3.finishing);
  const [captions, setCaptions] = useState<CaptionsMode>('burn');
  // The saved switches arrive after the first paint; the person's own picks here win after that.
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) { setFps(v3.fps); setFinishing(v3.finishing); } }, [v3.fps, v3.finishing, touched]);
  const pick = <T,>(set: (v: T) => void) => (v: T) => { setTouched(true); set(v); };

  const toggle = (a: Aspect) => setAspects((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  const running = !!p.progress;
  const captionsShown = !!p.hasCaptions || v3.captions;
  const radio = (on: boolean) => ({ padding: on ? '7px 11px' : '8px 12px', minHeight: 48, boxSizing: 'border-box', borderRadius: 10, border: on ? '2px solid var(--accent)' : '1px solid var(--line-input)', background: on ? 'var(--tint)' : 'var(--surface)', display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }) as const;
  const size = (on: boolean) => ({ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', border: on ? '2px solid var(--accent)' : '1px solid var(--line-input)', background: on ? 'var(--tint)' : 'var(--surface)', borderRadius: 10, padding: on ? '0 9px' : '0 10px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }) as const;
  const prog = p.progress;

  return (
    <main data-frame="ExportV3" style={{ flexGrow: 1, display: 'flex', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 560, maxWidth: '100%', boxSizing: 'border-box', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '18px 20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{EXPORT_COPY.title}</h1>
          <button type="button" aria-label="Close" onClick={p.onClose} className="icon-btn" style={{ width: 36, height: 36, borderRadius: 10 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </header>

        <fieldset disabled={running} style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div role="radiogroup" aria-label={EXPORT_COPY.format} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{EXPORT_COPY.format}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {EXPORT_COPY.kinds.map(([id, name, line]) => (
                <button key={id} type="button" role="radio" aria-checked={kind === id} onClick={() => setKind(id)} style={{ ...radio(kind === id), font: 'inherit', color: 'inherit', textAlign: 'left' }}>
                  <span aria-hidden="true" style={{ width: 13, height: 13, marginTop: 2, flexShrink: 0, borderRadius: '50%', boxSizing: 'border-box', border: kind === id ? '4px solid var(--accent)' : '1px solid #8F8F96', background: '#FFFFFF' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{line}</span></span>
                </button>
              ))}
            </div>
          </div>

          <div role="group" aria-label={EXPORT_COPY.sizes} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{EXPORT_COPY.sizes}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {ASPECTS.map((a) => (
                <label key={a} style={size(aspects.includes(a))}>
                  <input type="checkbox" aria-label={a} checked={aspects.includes(a)} onChange={() => toggle(a)} style={{ accentColor: 'var(--accent)', width: 16, height: 16, margin: 0 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><span className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{a}</span><span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{EXPORT_COPY.sizeUse[a]}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div role="radiogroup" aria-label={EXPORT_COPY.frameRate} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{EXPORT_COPY.frameRate}</span>
            <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: '#F1F1F3' }}>
              {([60, 30] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={fps === f} onClick={() => pick(setFps)(f)}
                  style={{ flex: 1, height: 36, border: 0, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', background: fps === f ? 'var(--surface)' : 'transparent', boxShadow: fps === f ? '0 1px 2px rgba(16,16,20,0.1)' : 'none', color: fps === f ? 'var(--accent-hover)' : '#3F3F46', font: `${fps === f ? 600 : 400} 12.5px var(--font)` }}>
                  <span className="mono">{f === 60 ? EXPORT_COPY.fps60 : EXPORT_COPY.fps30}</span>
                  {f === 60 && !p.fallback30 && <span style={{ height: 20, padding: '0 7px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{EXPORT_COPY.canDo60}</span>}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid #F1F1F3', paddingTop: 8 }}>
            <label style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', minHeight: 40, boxSizing: 'border-box', padding: '2px 0' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{EXPORT_COPY.finishing}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.35 }}>{FINISHING_LINE}</span>
              </span>
              <input type="checkbox" role="switch" aria-label={EXPORT_COPY.finishing} checked={finishing} onChange={(e) => pick(setFinishing)(e.target.checked)} className="switch-input" style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
              <span aria-hidden="true" className="switch-track" style={{ position: 'relative', width: 36, height: 20, flexShrink: 0, marginTop: 1, borderRadius: 999, background: finishing ? 'var(--accent)' : '#DCDCE0' }}>
                <span style={{ position: 'absolute', top: 2, left: finishing ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }} />
              </span>
            </label>
          </div>

          {captionsShown && (
            <div role="radiogroup" aria-label={EXPORT_COPY.captions} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 8, alignItems: 'baseline' }}><span>{EXPORT_COPY.captions}</span><span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{EXPORT_COPY.captionsOn}</span></span>
              <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: '#F1F1F3' }}>
                {EXPORT_COPY.captionModes.map(([id, name]) => (
                  <button key={id} type="button" role="radio" aria-checked={captions === id} onClick={() => setCaptions(id)}
                    style={{ flex: 1, height: 34, border: 0, borderRadius: 7, cursor: 'pointer', background: captions === id ? 'var(--surface)' : 'transparent', color: captions === id ? 'var(--accent-hover)' : 'var(--ink)', font: `${captions === id ? 600 : 500} 12.5px var(--font)` }}>{name}</button>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        {p.fallback30 && <StateCard id="export-60-fallback" onAction={p.onExport60Anyway} />}

        <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 10, background: '#F6F6F7', fontSize: 12, lineHeight: 1.4, color: '#3F3F46' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg><span>{EXPORT_COPY.line}</span>
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4 }}>{EXPORT_COPY.estimate(aboutLine(guessSeconds(p.clipSeconds, aspects.length, fps)), aspects.length)}</span>
          <button type="button" disabled={running || !aspects.length || !p.onExport} onClick={() => p.onExport?.({ kind, aspects, fps, finishing, captions: captionsShown ? captions : 'off' })}
            style={{ height: 44, padding: '0 20px', border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', font: '600 14px var(--font)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, opacity: running || !aspects.length || !p.onExport ? 0.5 : 1 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" /></svg>{exportButton(aspects.length)}
          </button>
        </div>

        {p.notice && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--ink)' }}>{p.notice}</p>}

        {prog && (
          <div role="status" aria-label="Export progress" style={{ borderRadius: 12, border: '1px solid var(--line)', background: '#FAFAFB', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12 }}><span style={{ fontWeight: 600 }}>{EXPORT_COPY.exporting(prog.index, prog.total)}</span><span className="mono" style={{ fontSize: 11.5 }}>{EXPORT_COPY.detail(prog.aspect, prog.frame, prog.frames, prog.finishing)}</span></span>
              <button type="button" onClick={p.onCancel} style={{ height: 32, padding: '0 12px', border: '1px solid var(--line-input)', borderRadius: 8, background: 'var(--surface)', font: '500 12px var(--font)', cursor: 'pointer' }}>{EXPORT_COPY.cancel}</button>
            </div>
            <div role="progressbar" aria-label={EXPORT_COPY.exporting(prog.index, prog.total)} aria-valuemin={0} aria-valuemax={prog.frames} aria-valuenow={prog.frame} style={{ height: 6, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.round((prog.frame / Math.max(1, prog.frames)) * 100)}%`, height: '100%', borderRadius: 999, background: 'var(--accent)' }} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
