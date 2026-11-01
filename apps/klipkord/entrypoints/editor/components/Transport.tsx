import type { Shape } from '@/lib/project/types';
import { clock } from '../format';
import { C, Icon, iconButton, ICONS, MONO } from '../ui';

export interface TransportProps {
  out: number;
  length: number;
  playing: boolean;
  /** Play works once the first frame shows. */
  canPlay: boolean;
  shape: Shape;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onFullscreen(): void;
  /** AutoVertical (T13) opens from the aspect label. */
  onShape?: () => void;
}

export function Transport(p: TransportProps) {
  return (
    <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px' }}>
      <span style={{ fontFamily: MONO, fontSize: 12, color: C.text, width: 110 }}>
        {clock(p.out, true)} <span style={{ color: C.muted }}>/ {clock(p.length)}</span>
      </span>
      <span style={{ flexGrow: 1 }} />
      <button type="button" aria-label="Previous sentence (J)" title="Previous sentence (J)" disabled={!p.canPlay} onClick={p.onPrev} style={iconButton()}>
        <Icon>{ICONS.prev}</Icon>
      </button>
      <button type="button" aria-label={p.playing ? 'Pause (Space)' : 'Play (Space)'} disabled={!p.canPlay} onClick={p.onToggle}
        style={{ width: 36, height: 36, borderRadius: '50%', border: 0, background: C.text, color: C.ground, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: p.canPlay ? 'pointer' : 'default', opacity: p.canPlay ? 1 : 0.5 }}>
        <Icon color={C.ground}>{p.playing ? ICONS.pause : ICONS.play}</Icon>
      </button>
      <button type="button" aria-label="Next sentence (L)" title="Next sentence (L)" disabled={!p.canPlay} onClick={p.onNext} style={iconButton()}>
        <Icon>{ICONS.next}</Icon>
      </button>
      <span style={{ flexGrow: 1 }} />
      <button type="button" onClick={p.onShape}
        style={{ height: 26, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: C.raised, color: C.secondary, fontFamily: 'inherit', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        {p.shape}<Icon size={12}>{ICONS.down}</Icon>
      </button>
      <button type="button" aria-label="Full screen preview (F)" title="Full screen preview (F)" onClick={p.onFullscreen} style={iconButton(28)}>
        <Icon>{ICONS.full}</Icon>
      </button>
    </div>
  );
}
