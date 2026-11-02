import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { autoZoomed, autoZoomOnOpen, removeLayer, updateLayer } from '@/lib/project/ops';
import { toOut } from '@/lib/project/time';
import type { Box, Cut, Feel, Zoom } from '@/lib/project/types';
import { FRAME, renderPlan } from '@/lib/render/plan';
import type { SlotProps } from '../components/slots';
import type { StageProps } from '../Editor';
import { clock } from '../format';
import { Heading, Seg, Slider, Switch } from '../timeline/controls';
import { times } from '../timeline/rows';
import { select, useTimeline } from '../timeline/store';
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

/** Runs autoZoom once per project (its `autoZoomed` flag) when a recording with events opens; nothing to draw. */
export function AutoZoomOnOpen({ project, recording, ready, readOnly, edit }: SlotProps) {
  const events = useEvents(project);
  const done = autoZoomed(project);
  useEffect(() => {
    if (done || !ready || readOnly || !events?.length) return;
    edit((proj) => autoZoomOnOpen(proj, { events, duration: recording.duration }));
  }, [done, ready, readOnly, events, edit, recording.duration]);
  return null;
}

type Spot = { x: number; y: number };
/** Where the screen picture sits on the preview: its crop (0..1 of the picture) and box (frame px). */
interface View { crop: Box; dest: Box }
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const toSpot = (v: View, fx: number, fy: number): Spot => ({
  x: clamp01(v.crop.x + ((fx - v.dest.x) / v.dest.w) * v.crop.w), y: clamp01(v.crop.y + ((fy - v.dest.y) / v.dest.h) * v.crop.h),
});
const toFrame = (v: View, s: Spot) => ({ x: v.dest.x + ((s.x - v.crop.x) / v.crop.w) * v.dest.w, y: v.dest.y + ((s.y - v.crop.y) / v.crop.h) * v.dest.h });
const withFocus = (cut: Cut, id: string, focus: Spot): Cut => ({ ...cut, zooms: cut.zooms.map((z) => (z.id === id ? { ...z, focus } : z)) });

/** The "Fixed spot" focus ring over the preview while that zoom is selected: click to place it, drag to move it. */
export function FocusStage({ project, cut, out, events, readOnly, edit, preview }: StageProps) {
  const { selected } = useTimeline();
  const [drag, setDrag] = useState<{ view: View; spot: Spot } | null>(null);
  const id = selected?.kind === 'zooms' && selected.ids.length === 1 ? selected.ids[0] : undefined;
  const zoom = cut.zooms.find((z) => z.id === id);
  if (!zoom || zoom.focus === 'cursor') return null;
  const screen = renderPlan(project, cut, out, events).screen;
  if (!screen) return null;
  const frame = FRAME[cut.shape];
  // The drag keeps the view it started on; the live zoom moving under the pointer would chase it.
  const view: View = drag?.view ?? { crop: screen.crop, dest: screen.dest };
  const placed = zoom.focus;
  const spot = drag?.spot ?? placed;
  const at = toFrame(view, spot);
  const spotAt = (e: PointerEvent<HTMLDivElement>, v: View) => {
    const r = e.currentTarget.getBoundingClientRect();
    return toSpot(v, ((e.clientX - r.left) / (r.width || 1)) * frame.w, ((e.clientY - r.top) / (r.height || 1)) * frame.h);
  };
  const move = (next: { view: View; spot: Spot }) => {
    setDrag(next);
    preview(withFocus(cut, zoom.id, next.spot));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (readOnly) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    move({ view, spot: spotAt(e, view) });
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => drag && move({ view: drag.view, spot: spotAt(e, drag.view) });
  const onUp = () => {
    if (!drag) return;
    const focus = drag.spot;
    setDrag(null);
    preview(null);
    if (focus.x !== placed.x || focus.y !== placed.y) edit((p) => updateLayer(p, { kind: 'zooms', id: zoom.id, patch: { focus } }));
  };
  return (
    <div data-testid="focus-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ position: 'absolute', inset: 0, cursor: readOnly ? 'default' : 'crosshair', touchAction: 'none' }}>
      <div aria-label="Focus" style={{ position: 'absolute', left: `${(at.x / frame.w) * 100}%`, top: `${(at.y / frame.h) * 100}%`, transform: 'translate(-50%, -50%)',
        width: 34, height: 34, borderRadius: '50%', border: '2px solid #FFFFFF', boxShadow: '0 0 0 1px rgba(0,0,0,0.35)', cursor: readOnly ? 'default' : 'grab' }}>
        <span style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translate(-50%, 4px)', padding: '1px 6px', borderRadius: 4,
          background: C.accentText, color: '#FFFFFF', fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap' }}>Focus</span>
      </div>
    </div>
  );
}
