import { useEffect, useRef, useState } from 'react';
import { TRACKS, type Mood, type Track } from '@/lib/audio/tracks';
import { setAudio } from '@/lib/project/ops';
import type { Project, Source } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { Seg, TL_ICONS, useEscape } from '../timeline/controls';
import { actionButton, C, Icon, iconButton, MONO } from '../ui';
import { browserMediaIO, importChoice, type MediaIO } from './AddMedia';

type Filter = 'All' | Mood;
// The frame's order.
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'All', label: 'All' }, { value: 'Calm', label: 'Calm' }, { value: 'Bright', label: 'Bright' }, { value: 'Driving', label: 'Driving' },
];
const ORDER = ['bright-morning', 'slow-tide', 'paper-planes', 'night-drive'];
/** "Fade both": each end of the music, ms, as addMusic sets it. */
export const FADE_MS = 1000;
const LISTED =[...TRACKS].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

/** A bundled track's sound in the dialog: play preview and its length. */
export interface TrackAudio {
  play(): Promise<void>; pause(): void;
  readonly duration: number;
  addEventListener(type: 'loadedmetadata' | 'ended', on: () => void): void;
}
const browserAudio = (src: string): TrackAudio => {
  const el = new Audio(src);
  el.preload = 'metadata';
  return el;
};

/** The project's source already made from a bundled track, so choosing it again copies nothing. */
export const bundledSource = (project: Project, track: Track): Source | undefined =>
  project.sources.find((s) => s.kind === 'music' && s.name === track.name);

/** MusicPicker (from the Audio tab's "Change"): bundled CC0 tracks by mood, play preview, own file or no music. */
export function MusicPicker({ p, onClose, onOwnFile, io = browserMediaIO, audio = browserAudio }: {
  p: SlotProps; onClose: () => void; onOwnFile: () => void; io?: MediaIO; audio?: (src: string) => TrackAudio;
}) {
  useEscape(onClose);
  const now = p.cut.audio.music?.source;
  const current = LISTED.find((t) => bundledSource(p.project, t)?.id === now);
  const [filter, setFilter] = useState<Filter>('All');
  const [chosen, setChosen] = useState<Track>(current ?? LISTED[0]!);
  const [playing, setPlaying] = useState<string | null>(null);
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const players = useRef(new Map<string, TrackAudio>());

  // One element per track reads its length up front and plays its preview later.
  useEffect(() => {
    const made = players.current;
    for (const t of LISTED) {
      const el = audio(t.file);
      el.addEventListener('loadedmetadata', () => setLengths((l) => ({ ...l, [t.id]: el.duration * 1000 })));
      el.addEventListener('ended', () => setPlaying((id) => (id === t.id ? null : id)));
      made.set(t.id, el);
    }
    return () => {
      made.forEach((el) => el.pause());
      made.clear();
    };
  }, [audio]);

  const toggle = (t: Track) => {
    setChosen(t);
    players.current.forEach((el, id) => { if (id !== t.id) el.pause(); });
    const el = players.current.get(t.id);
    if (playing === t.id) {
      el?.pause();
      setPlaying(null);
      return;
    }
    setPlaying(t.id);
    el?.play().catch((error: unknown) => console.error('Klipkord: could not play the track', error));
  };

  const use = async () => {
    if (busy || p.readOnly) return;
    const have = bundledSource(p.project, chosen);
    if (have) {
      // The same defaults as addMusic; the cut's own settings win.
      const music = { duck: true, fadeIn: FADE_MS, fadeOut: FADE_MS, volume: 0.3, ...p.cut.audio.music, source: have.id };
      if (have.id !== now) p.edit((q) => setAudio(q, { patch: { music } }));
      onClose();
      return;
    }
    setBusy(true);
    try {
      p.edit(await importChoice({ kind: 'track', track: chosen }, p, io));
      onClose();
    } catch (error) {
      console.error('Klipkord: could not add the music', error);
      setBusy(false);
    }
  };
  const none = () => {
    if (now && !p.readOnly) p.edit((q) => setAudio(q, { patch: { music: undefined } }));
    onClose();
  };

  const shown = LISTED.filter((t) => filter === 'All' || t.mood === filter);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,7,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Music" style={{ width: 480, maxHeight: 600, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 16px 0 20px' }}>
          <div style={{ flexGrow: 1 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.secondary }}>Plays under your voice and gets quieter while you talk.</p>
          </div>
          <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} style={iconButton()}><Icon>{TL_ICONS.close}</Icon></button>
        </div>
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <Seg label="Mood" options={FILTERS} value={filter} onChange={setFilter} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shown.map((t) => {
              const on = t.id === chosen.id;
              return (
                <div key={t.id} role="option" aria-selected={on} tabIndex={0} onClick={() => setChosen(t)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setChosen(t); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 10, cursor: 'pointer', background: C.raised, border: `1px solid ${on ? C.accentText : C.line}` }}>
                  <button type="button" aria-label={`Play ${t.name}`} aria-pressed={playing === t.id} onClick={(e) => { e.stopPropagation(); toggle(t); }}
                    style={{ ...iconButton(32), borderRadius: '50%', background: C.tabOn, color: C.text }}>
                    <Icon>{playing === t.id ? <><path d="M8 5v14" /><path d="M16 5v14" /></> : <path d="M7 4l13 8-13 8z" />}</Icon>
                  </button>
                  <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</span>
                    <span style={{ fontSize: 11.5, color: C.muted }}>{t.about}</span>
                  </span>
                  <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.secondary }}>{lengths[t.id] ? clock(lengths[t.id]!) : ''}</span>
                </div>
              );
            })}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>All bundled tracks are CC0: free to use anywhere, no credit needed. Short tracks loop to fill the video.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderTop: `1px solid ${C.line}` }}>
          <button type="button" onClick={onOwnFile} disabled={p.readOnly} style={{ ...actionButton('secondary'), height: 32, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon size={14}><path d="M12 15V3" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></Icon><span>Use your own file</span>
          </button>
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={none} style={{ ...actionButton('ghost'), height: 32 }}>No music</button>
          <button type="button" onClick={() => void use()} disabled={busy || p.readOnly}
            style={{ ...actionButton('primary'), height: 32, background: C.accent, color: '#FFFFFF', opacity: busy || p.readOnly ? 0.5 : 1 }}>Use this track</button>
        </div>
      </div>
    </div>
  );
}
