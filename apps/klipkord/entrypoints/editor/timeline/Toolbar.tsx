import type { ReactNode } from 'react';
import { clock } from '../format';
import { C, Icon, MONO } from '../ui';
import { TL_ICONS } from './controls';
import { sliderOf, type View } from './geometry';

export interface ToolbarProps {
  view: View;
  length: number;
  snap: boolean;
  hint: string;
  /** While the editor opens: the tools show but do nothing yet. */
  waiting?: boolean;
  can: { split: boolean; delete: boolean; speed: boolean; zoom: boolean; text: boolean; voiceover: boolean; media: boolean };
  onSplit(): void;
  onDelete(): void;
  onSpeed(): void;
  onZoom(): void;
  onText(): void;
  onVoiceover(): void;
  onMedia(): void;
  onSnap(): void;
  onSlider(v: number): void;
  onFit(): void;
}

function Tool({ label, icon, onClick, disabled, on, size = 30, dim = true }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; on?: boolean; size?: number; dim?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} aria-pressed={on}
      style={{ width: size, height: size, border: 0, borderRadius: 8, background: on ? C.tabOn : 'transparent', color: C.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled && dim ? 0.4 : 1, flexShrink: 0 }}>
      <Icon>{icon}</Icon>
    </button>
  );
}

/** Timeline toolbar: Split, Delete, Speed, Zoom, Text or card, Voiceover, Add media, Snapping; visible range, zoom slider, Fit. */
export function Toolbar(p: ToolbarProps) {
  const range = `${clock(p.view.start)} to ${clock(Math.min(p.view.end, Math.max(p.length, p.view.end)))}`;
  return (
    <div style={{ height: 36, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', background: C.panel, borderBottom: `1px solid ${C.line}` }}>
      <Tool label="Split at playhead (S)" icon={TL_ICONS.split} onClick={p.onSplit} disabled={p.waiting || !p.can.split} dim={!p.waiting} />
      <Tool label="Delete selection (Del)" icon={TL_ICONS.trash} onClick={p.onDelete} disabled={p.waiting || !p.can.delete} dim={!p.waiting} />
      <Tool label="Speed (R)" icon={TL_ICONS.speed} onClick={p.onSpeed} disabled={p.waiting || !p.can.speed} dim={!p.waiting} />
      <Tool label="Add zoom (Z)" icon={TL_ICONS.zoom} onClick={p.onZoom} disabled={p.waiting || !p.can.zoom} dim={!p.waiting} />
      <Tool label="Add text or card (T)" icon={TL_ICONS.text} onClick={p.onText} disabled={p.waiting || !p.can.text} dim={!p.waiting} />
      <Tool label="Record a voiceover (V)" icon={TL_ICONS.mic} onClick={p.onVoiceover} disabled={p.waiting || !p.can.voiceover} dim={!p.waiting} />
      <Tool label="Add media (A)" icon={TL_ICONS.plus} onClick={p.onMedia} disabled={p.waiting || !p.can.media} dim={!p.waiting} />
      <span style={{ width: 1, height: 18, background: C.line, margin: '0 6px' }} />
      <Tool label="Snap to words, clicks and markers (N)" icon={TL_ICONS.magnet} onClick={p.onSnap} on={p.snap} disabled={p.waiting} dim={!p.waiting} />
      {p.hint && <span role="status" style={{ fontSize: 11.5, color: C.muted, marginLeft: 6, whiteSpace: 'nowrap' }}>{p.hint}</span>}
      <span style={{ flexGrow: 1 }} />
      <span style={{ fontSize: 11.5, color: C.muted, fontFamily: MONO }}>{range}</span>
      <input type="range" aria-label={range} min={0} max={1} step={0.01} value={sliderOf(p.view, p.length)} disabled={p.waiting} onChange={(e) => p.onSlider(Number(e.target.value))}
        className="kk-range kk-plain" style={{ width: 80, margin: '0 6px 0 10px' }} />
      <Tool label="Fit the whole video (Shift+Z)" icon={TL_ICONS.fit} onClick={p.onFit} size={28} disabled={p.waiting} dim={!p.waiting} />
    </div>
  );
}
