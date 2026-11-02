import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Span } from '@/lib/project/time';
import type { Cut } from '@/lib/project/types';
import type { Word } from '@/lib/types';
import { NoClicks } from '../states/tracks';
import { C, Icon } from '../ui';
import { TL_ICONS } from './controls';
import type { Filmstrip } from './filmstrip';
import { HEAD_PX, xOf, type View } from './geometry';
import type { Block, Look, Row } from './rows';

export const ROW_PX = 26;

const LOOKS: Record<Look, { bg: string; border: string; text: string }> = {
  screen: { bg: '#33333B', border: C.line, text: '#FFFFFF' },
  media: { bg: '#33333B', border: C.line, text: '#FFFFFF' },
  camera: { bg: '#2B2B33', border: C.line, text: C.secondary },
  voice: { bg: '#1E1E24', border: C.line, text: C.secondary },
  zoom: { bg: 'rgba(180,83,9,0.28)', border: '#B45309', text: '#FCD34D' },
  text: { bg: 'rgba(15,118,110,0.45)', border: '#0F766E', text: '#99F6E4' },
  music: { bg: 'rgba(29,78,216,0.35)', border: '#1D4ED8', text: '#BFDBFE' },
  voiceover: { bg: 'rgba(220,38,38,0.25)', border: '#DC2626', text: '#FECACA' },
};

const ROW_ICONS: Record<Row['key'], ReactNode> = {
  screen: TL_ICONS.screen, camera: TL_ICONS.camera, voice: TL_ICONS.mic, voiceover: TL_ICONS.mic, media: TL_ICONS.screen,
  zoom: TL_ICONS.zoom, text: TL_ICONS.text, music: TL_ICONS.music,
};

export type Part = 'body' | 'start' | 'end';

export interface TrackHandlers {
  onBlockDown(e: ReactPointerEvent, block: Block, part: Part): void;
  onBlockMenu(e: ReactMouseEvent, block: Block): void;
  onEmptyDown(e: ReactPointerEvent, row: Row): void;
  onHint(add: NonNullable<Row['hint']>['add']): void;
  onToggle(row: Row, flag: 'hidden' | 'locked' | 'muted'): void;
}

const EDGE_PX = 6;

function HeadButton({ label, on, icon, onClick }: { label: string; on: boolean; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={on} onClick={onClick}
      style={{ border: 0, background: 'transparent', color: on ? C.accentText : C.muted, padding: 0, display: 'flex', cursor: 'pointer', opacity: on ? 1 : undefined }}>
      <Icon size={12}>{icon}</Icon>
    </button>
  );
}

/** The track names column: icon, name, then Mute, Hide and Lock as the frame orders them. */
function TrackHead({ row, cut, onToggle }: { row: Row; cut: Cut; onToggle: TrackHandlers['onToggle'] }) {
  const flag = (f: 'hidden' | 'locked' | 'muted') => row.tracks.every((t) => !!cut.tracks[t]?.[f]);
  return (
    <div style={{ width: HEAD_PX, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 6px 0 10px', color: C.secondary, fontSize: 11.5, background: C.panel, boxSizing: 'border-box', position: 'sticky', left: 0, zIndex: 3 }}>
      <Icon size={13}>{ROW_ICONS[row.key]}</Icon>
      <span style={{ flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
      {row.mute && <HeadButton label={`Mute ${row.name}`} on={flag('muted')} icon={TL_ICONS.sound} onClick={() => onToggle(row, 'muted')} />}
      <HeadButton label={`Hide ${row.name}`} on={flag('hidden')} icon={TL_ICONS.eye} onClick={() => onToggle(row, 'hidden')} />
      <HeadButton label={`Lock ${row.name}`} on={flag('locked')} icon={TL_ICONS.lock} onClick={() => onToggle(row, 'locked')} />
    </div>
  );
}

/** FRAMES.md "Empty track hints": a + at the left edge, then one muted line. */
function Hint({ hint, onHint }: { hint: NonNullable<Row['hint']>; onHint: TrackHandlers['onHint'] }) {
  return (
    <div data-state="empty-track" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', fontSize: 11.5, color: C.muted, pointerEvents: 'none' }}>
      {hint.add && (
        <button type="button" aria-label={hint.text} title={hint.text} onClick={() => onHint(hint.add)}
          style={{ width: 20, height: 20, borderRadius: 6, border: `1px solid ${C.line}`, background: C.raised, color: C.secondary, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: 'pointer', pointerEvents: 'auto', flexShrink: 0 }}>
          <Icon size={12}>{TL_ICONS.plus}</Icon>
        </button>
      )}
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hint.text}</span>
    </div>
  );
}

export interface StripProps {
  kind: 'film' | 'wave';
  blocks: Block[];
  clipSpans: readonly Span[];
  view: View;
  width: number;
  film?: Filmstrip | null;
  /** File time of rec 0 in the filmstrip's file. */
  offset?: number;
  words?: readonly Word[];
}

/** One canvas per track for the filmstrip or the voice bars, drawn only over the blocks in view. */
function Strip({ kind, blocks, clipSpans, view, width, film, offset = 0, words = [] }: StripProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = useRef<() => void>(() => {});
  draw.current = () => {
    const canvas = ref.current;
    const g = canvas?.getContext?.('2d');
    if (!canvas || !g) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(ROW_PX * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, ROW_PX);
    for (const b of blocks) {
      const span = clipSpans[b.index ?? -1];
      if (!span || b.gap) continue;
      const x0 = Math.max(0, xOf(b.start, view, width)) + 2;
      const x1 = Math.min(width, xOf(b.end, view, width)) - 2;
      if (x1 <= x0) continue;
      g.save();
      g.beginPath();
      g.rect(x0, 4, x1 - x0, ROW_PX - 8);
      g.clip();
      const recAt = (x: number) => span.clip.in + (view.start + (x / width) * (view.end - view.start) - span.start) * span.clip.speed;
      if (kind === 'film' && film) {
        const tile = Math.round((ROW_PX - 8) * 16 / 9);
        g.globalAlpha = 0.85;
        for (let x = x0; x < x1; x += tile) {
          const img = film.at(recAt(x + tile / 2) - offset);
          if (img) g.drawImage(img, x, 4, tile, ROW_PX - 8);
        }
      } else if (kind === 'wave') {
        g.fillStyle = C.secondary;
        let w = 0;
        for (let x = x0; x < x1; x += 4) {
          const a = recAt(x);
          const b2 = recAt(x + 4);
          while (w < words.length && words[w]!.end <= a) w += 1;
          let said = 0;
          for (let i = w; i < words.length && words[i]!.start < b2; i += 1) said += Math.min(b2, words[i]!.end) - Math.max(a, words[i]!.start);
          const share = Math.min(1, said / Math.max(1, b2 - a));
          const h = 2 + Math.round(share * 10 * (0.7 + 0.3 * Math.abs(Math.sin(x * 0.37))));
          g.fillRect(x, (ROW_PX - h) / 2, 3, h);
        }
      }
      g.restore();
    }
  };
  useEffect(() => { draw.current(); });
  useEffect(() => {
    if (!film) return;
    let frame = 0;
    const off = film.onChange(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; draw.current(); });
    });
    return () => { off(); cancelAnimationFrame(frame); };
  }, [film]);
  return <canvas ref={ref} aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, width, height: ROW_PX, pointerEvents: 'none', zIndex: 1 }} />;
}

export interface TrackProps extends TrackHandlers {
  row: Row;
  cut: Cut;
  view: View;
  width: number;
  selected: ReadonlySet<string>;
  /** While dragging: where a block shows instead of its own place. */
  moved?: (b: Block) => { start: number; end: number } | null;
  strip?: Omit<StripProps, 'blocks' | 'view' | 'width' | 'kind'> & { kind: StripProps['kind'] };
}

export function Track({ row, cut, view, width, selected, moved, strip, ...on }: TrackProps) {
  const hidden = row.tracks.every((t) => !!cut.tracks[t]?.hidden);
  const showHint = row.blocks.length === 0 && (row.noClicks || row.hint);
  return (
    <div data-track={row.key} style={{ display: 'flex', height: ROW_PX, borderBottom: `1px solid ${C.ground}` }}>
      <TrackHead row={row} cut={cut} onToggle={on.onToggle} />
      <div style={{ flexGrow: 1, position: 'relative', opacity: hidden ? 0.4 : 1, overflow: 'hidden' }} onPointerDown={(e) => { if (e.target === e.currentTarget) on.onEmptyDown(e, row); }}>
        {showHint && (row.noClicks && row.key === 'zoom'
          ? <div style={{ position: 'absolute', inset: 0 }}><NoClicks onAddZoom={() => on.onHint('zoom')} /></div>
          : row.hint && (row.key !== 'zoom' || !row.noClicks) && <Hint hint={row.hint} onHint={on.onHint} />)}
        {row.blocks.map((b) => {
          const place = moved?.(b) ?? b;
          const left = xOf(place.start, view, width);
          const right = xOf(place.end, view, width);
          const look = LOOKS[b.look];
          const isOn = selected.has(b.id);
          return (
            <span key={b.key} data-block={b.kind} data-id={b.id} role="button" tabIndex={-1} aria-label={b.label || row.name} aria-pressed={isOn}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const part: Part = b.resizable && e.clientX - r.left < EDGE_PX ? 'start' : b.resizable && r.right - e.clientX < EDGE_PX ? 'end' : 'body';
                on.onBlockDown(e, b, part);
              }}
              onContextMenu={(e) => on.onBlockMenu(e, b)}
              style={{
                ...(b.live && { pointerEvents: 'none' }),
                position: 'absolute', left, width: Math.max(2, right - left - 1), top: 2, bottom: 2, borderRadius: 5, boxSizing: 'border-box', overflow: 'hidden',
                display: 'flex', alignItems: 'center', cursor: b.movable ? 'grab' : 'pointer', touchAction: 'none',
                background: b.gap ? 'repeating-linear-gradient(135deg, #1F1F25 0 6px, #16161A 6px 12px)' : isOn ? '#3B2A22' : look.bg,
                border: `1px solid ${isOn ? C.accentText : look.border}`, boxShadow: isOn ? `0 0 0 1px ${C.accentText}` : undefined,
              }}>
              {b.resizable && <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: EDGE_PX, cursor: 'ew-resize', zIndex: 2 }} />}
              {b.live ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '0 6px', fontSize: 10.5, fontWeight: 600, color: '#FCA5A5', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#DC2626', flexShrink: 0 }} />{b.label}
                </span>
              ) : b.label && <span style={{ position: 'relative', zIndex: 2, fontSize: 10.5, fontWeight: 600, color: look.text, padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', pointerEvents: 'none' }}>{b.label}</span>}
              {b.resizable && <span aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: EDGE_PX, cursor: 'ew-resize', zIndex: 2 }} />}
            </span>
          );
        })}
        {strip && row.blocks.length > 0 && <Strip {...strip} blocks={row.blocks} view={view} width={width} />}
      </div>
    </div>
  );
}
