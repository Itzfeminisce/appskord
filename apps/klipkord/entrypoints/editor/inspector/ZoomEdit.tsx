import { useEffect, useRef, useState } from 'react';
import { autoZoomOnOpen, removeLayer, updateLayer } from '@/lib/project/ops';
import { toOut } from '@/lib/project/time';
import type { Feel, Zoom } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { Heading, Seg, Slider, Switch } from '../timeline/controls';
import { times } from '../timeline/rows';
import { select } from '../timeline/store';
import { useEvents } from '../transcript/events';
import { C, MONO } from '../ui';

const FOCUS = [{ value: 'cursor', label: 'Follow cursor' }, { value: 'fixed', label: 'Fixed spot' }] as const;
const FEELS: { value: Feel; label: string }[] = [{ value: 'calm', label: 'Calm' }, { value: 'smooth', label: 'Smooth' }, { value: 'snappy', label: 'Snappy' }];
const CENTRE = { x: 0.5, y: 0.5 };
export const DEPTH_MIN = 1.1;
export const DEPTH_MAX = 3;

/** The inspector header's place for one zoom: "2 of 6 · auto". */
export const zoomPlace = (index: number, count: number, zoom: Zoom) => `${index} of ${count}${zoom.auto ? ' · auto' : ''}`;

/** ZoomEdit: one zoom block selected. Depth, focus, feel, motion blur (Later) and every zoom with why it was made. */
export function ZoomEdit({ p, zoom }: { p: SlotProps; zoom: Zoom }) {
  const [depth, setDepth] = useState<number | null>(null);
  // Fixed spot comes back where it was after a turn on Follow cursor.
  const spot = useRef(zoom.focus === 'cursor' ? CENTRE : zoom.focus);
  if (zoom.focus !== 'cursor') spot.current = zoom.focus;
  const shown = depth ?? zoom.depth;
  const all = p.cut.zooms;
  const patch = (change: Partial<Zoom>) => !p.readOnly && p.edit((project) => updateLayer(project, { kind: 'zooms', id: zoom.id, patch: change }));
  const removeAll = () => {
    if (p.readOnly) return;
    select(null);
    p.edit((project) => removeLayer(project, { kind: 'zooms', ids: all.map((z) => z.id) }));
  };
  const open = (z: Zoom) => {
    select({ kind: 'zooms', ids: [z.id] });
    const at = toOut(p.cut, z.at);
    if (at !== null) p.seek(at);
  };
  return (
    <>
      <Heading>Depth</Heading>
      <div role="group" aria-label="Depth">
        <Slider min={DEPTH_MIN} max={DEPTH_MAX} step={0.1} value={shown} text={`${shown.toFixed(1)}x`} onInput={setDepth}
          onCommit={(v) => { setDepth(null); if (v !== zoom.depth) patch({ depth: v }); }} />
      </div>
      <Heading>Focus</Heading>
      <Seg label="Focus" options={FOCUS} value={zoom.focus === 'cursor' ? 'cursor' : 'fixed'}
        onChange={(v) => patch({ focus: v === 'cursor' ? 'cursor' : spot.current })} />
      <Heading>Feel</Heading>
      <Seg label="Feel" options={FEELS} value={zoom.feel} onChange={(feel) => feel !== zoom.feel && patch({ feel })} />
      <Switch label="Motion blur" sub="Later. Shown so you know it is coming." on={false} disabled onChange={() => {}} />
      <Heading aside={(
        <button type="button" onClick={removeAll} disabled={p.readOnly}
          style={{ border: 0, background: 'transparent', color: C.accentText, fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, padding: 0, cursor: p.readOnly ? 'default' : 'pointer' }}>
          {`Remove all ${all.length}`}
        </button>
      )}>All zooms</Heading>
      <ul aria-label="All zooms" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {all.map((z) => (
          <li key={z.id}>
            <button type="button" aria-current={z.id === zoom.id ? 'true' : undefined} onClick={() => open(z)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', border: 0, borderBottom: `1px solid ${C.line}`,
                background: z.id === zoom.id ? C.raised : 'transparent', color: C.text, fontFamily: 'inherit', fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted, width: 30, flexShrink: 0 }}>{clock(toOut(p.cut, z.at) ?? z.at)}</span>
              <span style={{ flexGrow: 1 }}>{z.why ?? ''}</span>
              <span style={{ fontFamily: MONO, fontSize: 11.5, color: C.secondary }}>{times(z.depth)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Runs autoZoom once when a recording with events first opens; nothing to draw. */
export function AutoZoomOnOpen({ project, recording, ready, readOnly, edit }: SlotProps) {
  const events = useEvents(project);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || readOnly || !events) return;
    done.current = true;
    if (events.length) edit((proj) => autoZoomOnOpen(proj, { events, duration: recording.duration }));
  }, [ready, readOnly, events, edit, recording.duration]);
  return null;
}
