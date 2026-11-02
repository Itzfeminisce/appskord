import { useCallback, useEffect, useRef, useState } from 'react';
import { clock } from '../format';
import { Icon, ICONS, MONO } from '../ui';

/** The bottom bar hides after the pointer has been still this long. */
export const BAR_HIDE_MS = 2000;

/** True while the bar shows: any pointer move or key press brings it back for BAR_HIDE_MS. */
export function useIdleBar(active: boolean, ms = BAR_HIDE_MS): { shown: boolean; wake(): void } {
  const [shown, setShown] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wake = useCallback(() => {
    setShown(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), ms);
  }, [ms]);
  useEffect(() => {
    if (!active) return;
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => { window.removeEventListener('mousemove', wake); window.removeEventListener('keydown', wake); clearTimeout(timer.current); };
  }, [active, wake]);
  return { shown: active && shown, wake };
}

export interface PreviewFullscreenProps {
  /** True while the preview is full screen. */
  active: boolean;
  playing: boolean;
  out: number;
  length: number;
  onToggle(): void;
  seek(out: number): void;
  /** Esc goes back. */
  onExit(): void;
}

/** Full screen preview: the video fills the screen; this draws only the bottom bar, which hides after 2 s. */
export function PreviewFullscreen(p: PreviewFullscreenProps) {
  const { shown } = useIdleBar(p.active);
  useEffect(() => {
    if (!p.active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onExit(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.active, p.onExit]);
  if (!p.active) return null;
  const share = p.length > 0 ? Math.min(1, Math.max(0, p.out / p.length)) : 0;
  return (
    <div role="toolbar" aria-label="Full screen preview" data-shown={shown} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 72, boxSizing: 'border-box', padding: '0 24px 14px', display: 'flex',
      alignItems: 'flex-end', gap: 14, background: 'linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.75))', opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', transition: 'opacity 0.2s' }}>
      <button type="button" aria-label={p.playing ? 'Pause (Space)' : 'Play (Space)'} onClick={p.onToggle}
        style={{ width: 36, height: 36, borderRadius: '50%', border: 0, background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
        <Icon color="#111114">{p.playing ? ICONS.pause : ICONS.play}</Icon>
      </button>
      <span style={{ fontFamily: MONO, fontSize: 12, color: '#FFFFFF' }}>{clock(p.out)} / {clock(p.length)}</span>
      <div role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(p.length)} aria-valuenow={Math.round(p.out)} tabIndex={0}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width > 0) p.seek(Math.round(p.length * Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))); }}
        style={{ flexGrow: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.3)', marginBottom: 16, position: 'relative', cursor: 'pointer' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${share * 100}%`, background: '#FFFFFF', borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>Esc to go back</span>
    </div>
  );
}
