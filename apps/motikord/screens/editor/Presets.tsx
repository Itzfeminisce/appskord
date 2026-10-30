import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applyPatch } from '../../lib/patch';
import { getPreset, presetsFor, type Preset } from '../../lib/render/presets';
import { findLayer, sceneStart, type Edit, type Found } from '../../lib/editor/store';
import type { Feel, Layer, Motion, PatchOp, PresetSlot, Recipe } from '../../lib/types';
import Editor, { useEditor } from './Editor';
import { motionLabel } from './LayerTab';

// Presets, PresetsDuring and PresetsOut frames: the popover a Motion row opens. Pointing at a tile previews it without saving.

const TABS: [PresetSlot, string][] = [['in', 'Comes in'], ['during', 'While on screen'], ['out', 'Goes out']];
const FEELS: [Feel, string][] = [['smooth', 'Smooth'], ['snappy', 'Snappy'], ['bouncy', 'Bouncy'], ['steady', 'Steady']];

const ic = (w: number, stroke: string, body: ReactNode, cap = true) => (
  <svg width={w} height="18" viewBox={`0 0 ${w} 18`} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap={cap ? 'round' : undefined} aria-hidden="true">{body}</svg>
);
/** Tile pictures, as the three frames draw them. */
function TileIcon({ id, on }: { id: string; on: boolean }) {
  const s = on ? 'var(--accent)' : 'var(--muted)';
  switch (id) {
    case 'fade-in': return <span style={{ width: 26, height: 10, borderRadius: 3, background: 'linear-gradient(90deg, rgba(190,24,93,0.15), var(--accent))' }} />;
    case 'fade-out': return <span style={{ width: 26, height: 10, borderRadius: 3, background: 'linear-gradient(90deg, var(--accent), rgba(190,24,93,0.15))' }} />;
    case 'rise-in': case 'rise-out': return ic(26, s, <path d="M5 15h16M13 13V3M9 7l4-4 4 4" />);
    case 'pop-in': case 'pop-out': return ic(22, s, <><circle cx="11" cy="9" r="3" /><circle cx="11" cy="9" r="7" strokeDasharray="2 3" /></>, false);
    case 'slide-in': return ic(26, s, <path d="M3 9h16M15 5l4 4-4 4" />);
    case 'slide-out': return ic(26, s, <path d="M7 9h16M11 5l-4 4 4 4" />);
    case 'wipe-in': case 'wipe-out': return ic(26, s, <><rect x="3" y="3" width="20" height="12" rx="2" /><path d="M13 3v12" strokeDasharray="2 2" /></>, false);
    case 'type-on': return <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: s }}>Ab_</span>;
    case 'grow-in': return ic(22, s, <><rect x="7" y="5" width="8" height="8" rx="1" /><rect x="3" y="1" width="16" height="16" rx="2" strokeDasharray="2 3" /></>, false);
    case 'blur-in': return <span style={{ width: 24, height: 12, borderRadius: 3, background: 'var(--line-strong)', filter: 'blur(2px)' }} />;
    case 'drop-in': case 'drop-out': return ic(26, s, <path d="M5 3h16M13 5v10M9 11l4 4 4-4" />);
    case 'bounce': return ic(26, s, <><path d="M3 15h20" /><circle cx="13" cy="6" r="3" /><path d="M13 10.5v2" strokeDasharray="1 2" /></>);
    case 'pulse': return ic(22, s, <><circle cx="11" cy="9" r="4" /><circle cx="11" cy="9" r="7.5" strokeDasharray="2 3" /></>);
    case 'float': return ic(26, s, <path d="M3 11c3-4 7-4 10 0s7 4 10 0" />);
    case 'shake': return ic(26, s, <><path d="M3 9h3M20 9h3" /><rect x="9" y="4" width="8" height="10" rx="1.5" /></>);
    case 'slow-zoom': return ic(22, s, <><rect x="5" y="4" width="12" height="10" rx="1.5" /><path d="M2 1h4M2 1v4M20 17h-4M20 17v-4" /></>);
    case 'glow': return <span style={{ width: 24, height: 12, borderRadius: 3, background: 'var(--muted)', boxShadow: '0 0 8px 2px rgba(190,24,93,0.45)' }} />;
    default: return null;
  }
}

/** "title" for a title, "caption" for a caption; shapes, photos, videos and charts by their type. */
export function kindOf(l: Layer): string {
  if (l.type === 'text') return l.role;
  if (l.type === 'image') return 'photo';
  return l.type;
}
const sameKind = (a: Layer, b: Layer) => kindOf(a) === kindOf(b);

const put = (path: string, has: boolean, value: unknown): PatchOp => (has ? { op: 'replace', path, value } : { op: 'add', path, value });

/** Sets one motion slot; repeated sets of the same slot merge into one Change. */
export function setMotion(f: Found, slot: PresetSlot, m: Motion): Edit {
  return { ops: [put(`${f.path}/${slot}`, Object.hasOwn(f.layer, slot), m)], summary: `${f.layer.name}: ${motionLabel(m)}`, mergeKey: `${f.layer.id}/${slot}` };
}

/** "Use on every title": the slot's motion on every layer of the same kind, in every scene. */
export function useOnEvery(r: Recipe, f: Found, slot: PresetSlot, m: Motion): Edit | undefined {
  const ops: PatchOp[] = [];
  r.scenes.forEach((s, si) => s.layers.forEach((l, li) => {
    if (!sameKind(l, f.layer)) return;
    const cur = l[slot];
    if (cur && cur.preset === m.preset && cur.feel === m.feel && cur.durationMs === m.durationMs) return;
    ops.push(put(`/scenes/${si}/layers/${li}/${slot}`, Object.hasOwn(l, slot), m));
  }));
  return ops.length ? { ops, summary: `Every ${kindOf(f.layer)}: ${motionLabel(m)}` } : undefined;
}

/** The first feel the preset supports when it cannot take the one asked for (Type on has no Bouncy). */
const feelFor = (p: Preset, want: Feel): Feel => (p.feels.includes(want) ? want : p.feels[0]!);

/** When the slot's motion plays, so pointing at a tile shows that moment. */
function slotStart(r: Recipe, f: Found, slot: PresetSlot, m: Motion): number {
  const at = sceneStart(r, f.si);
  if (slot === 'in') return at + f.layer.startMs;
  if (slot === 'out') return at + Math.max(f.layer.startMs, f.layer.endMs - m.durationMs - 300);
  return at + f.layer.startMs + (f.layer.in?.durationMs ?? 0);
}

export function PresetsPopover({ sceneId, layerId, slot: firstSlot, onClose }: { sceneId: string; layerId: string; slot: PresetSlot; onClose: () => void }) {
  const { state, edit, setPreview, setTime, play, playhead, select } = useEditor();
  const r = state.clip.recipe;
  const f = findLayer(r, sceneId, layerId);
  const [slot, setSlot] = useState<PresetSlot>(firstSlot);
  const resume = useRef<number>(undefined);

  const stopPreview = () => {
    const back = resume.current;
    if (back === undefined) return;
    resume.current = undefined;
    setPreview(undefined);
    play(false);
    // The canvas settles its playhead on the frame after playback stops; put the time and selection back after that.
    requestAnimationFrame(() => requestAnimationFrame(() => { playhead.current = back; select(sceneId, layerId, back); }));
  };
  useEffect(() => () => stopPreview(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return null;
  const l = f.layer;
  const cur = l[slot];
  const curPreset = cur ? getPreset(cur.preset) : undefined;
  const feel = cur?.feel ?? 'smooth';
  const tiles = presetsFor(slot);

  const motionWith = (p: Preset): Motion => ({ preset: p.id, feel: feelFor(p, feel), durationMs: cur?.durationMs ?? p.defaultMs });

  const preview = (p: Preset) => {
    const m = motionWith(p);
    const next = applyPatch(r, setMotion(f, slot, m).ops).doc;
    resume.current ??= playhead.current;
    setPreview(next);
    setTime(slotStart(next, f, slot, m));
    play(true);
  };
  const pick = (p: Preset) => {
    stopPreview();
    edit(setMotion(f, slot, motionWith(p)), { select: { sceneId, layerId } });
  };
  const setFeel = (v: Feel) => { if (cur && cur.feel !== v) edit(setMotion(f, slot, { ...cur, feel: v })); };
  const setLength = (s: number) => { if (cur) edit(setMotion(f, slot, { ...cur, durationMs: Math.round(s * 1000) })); };
  const every = () => { if (cur) edit(useOnEvery(r, f, slot, cur), { toast: true }); };
  const seconds = (cur?.durationMs ?? curPreset?.defaultMs ?? 600) / 1000;

  return (
    <div role="dialog" aria-label={`${l.name} motion`} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      style={{ width: 360, maxHeight: '100%', boxSizing: 'border-box', padding: 16, display: 'flex', flexDirection: 'column', gap: 14, background: 'var(--surface)', color: 'var(--ink)', borderRadius: 16, border: '1px solid var(--line)', boxShadow: '0 12px 32px rgba(16,16,20,0.12)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{`${l.name} motion`}</h1>
        <button type="button" aria-label="Close" onClick={onClose} style={{ width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <div role="tablist" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
        {TABS.map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={slot === id} onClick={() => { stopPreview(); setSlot(id); }} style={seg(slot === id)}>{text}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }} onPointerLeave={stopPreview}>
        {tiles.map((p) => {
          const on = cur?.preset === p.id;
          return (
            <button key={p.id} type="button" aria-pressed={on} onPointerEnter={() => preview(p)} onFocus={() => preview(p)} onBlur={stopPreview} onClick={() => pick(p)}
              style={{ height: 72, border: on ? '2px solid var(--accent)' : '1px solid var(--line)', borderRadius: 10, background: on ? 'var(--tint)' : 'var(--surface)', color: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, font: `${on ? 600 : 400} 12px/1 var(--font)`, cursor: 'pointer' }}>
              <TileIcon id={p.id} on={on} />{p.label}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Point at a preset to preview it on the canvas.</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Feel</span>
        <div role="radiogroup" aria-label="Feel" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
          {FEELS.map(([id, text]) => (
            <button key={id} type="button" role="radio" aria-checked={feel === id} disabled={!cur || (curPreset && !curPreset.feels.includes(id))} onClick={() => setFeel(id)} style={seg(feel === id)}>{text}</button>
          ))}
        </div>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>How long</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{`${seconds.toFixed(1)} s`}</span></span>
        <input type="range" min="0.2" max="2" step="0.1" value={seconds} disabled={!cur} onChange={(e) => setLength(Number(e.target.value))} style={{ accentColor: 'var(--accent)', width: '100%', margin: 0 }} />
      </label>
      <div style={{ flexGrow: 1 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={!cur} onClick={every} style={{ flex: 1, height: 40, border: '1px solid var(--line-strong)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>{`Use on every ${kindOf(l)}`}</button>
        <button type="button" onClick={onClose} style={{ flex: 1, height: 40, border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>Done</button>
      </div>
    </div>
  );
}

function seg(on: boolean) {
  return {
    height: 30, border: 0, borderRadius: 6, background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,16,20,0.08)' : undefined,
    font: `${on ? 600 : 400} 12px/1 var(--font)`, color: on ? 'var(--ink)' : 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer',
  } as const;
}

/** Route screen (dev `?screen=Presets`): the editor with the popover open on the selected layer. */
export default function Presets() {
  return <Editor open="presets" />;
}
