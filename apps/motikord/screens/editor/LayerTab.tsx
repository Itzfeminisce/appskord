import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clipColours, clock, findLayer, parseClock, sceneStart, setField, setTiming, type Found } from '../../lib/editor/store';
import { getPreset } from '../../lib/render/presets';
import type { Layer, Motion, PresetSlot } from '../../lib/types';
import { useEditor } from './Editor';

const label = { fontSize: 12, color: 'var(--muted)' } as const;
const field = { height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', font: '13px/1 var(--font)', color: 'var(--ink)', background: 'var(--surface)', width: '100%' } as const;
const mono = { ...field, fontFamily: 'var(--mono)' } as const;

const TYPE: Record<Layer['type'], string> = { text: 'Text', shape: 'Shape', image: 'Image', video: 'Video', chart: 'Chart' };
const SLOTS: [PresetSlot, string][] = [['in', 'Comes in'], ['during', 'While on screen'], ['out', 'Goes out']];
const MAX_SWATCHES = 8;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Rise · Smooth · 0.6 s", as the Motion rows show a preset. */
export const motionLabel = (m?: Motion) => (m ? `${getPreset(m.preset)?.label ?? m.preset} · ${cap(m.feel)} · ${(m.durationMs / 1000).toFixed(1)} s` : 'None');

function Labelled({ name, children }: { name: string; children: ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>{name}</span>{children}</label>;
}

export function LayerTab() {
  const { state, go } = useEditor();
  const r = state.clip.recipe;
  const f = findLayer(r, state.sceneId, state.layerId);
  return (
    <>
      <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
        <span aria-current="page" style={{ flex: 1, height: 28, borderRadius: 6, background: 'var(--surface)', boxShadow: '0 1px 2px rgba(16,16,20,0.08)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>Layer</span>
        <button type="button" onClick={() => go('EditorPrompt')} style={{ flex: 1, height: 28, border: 0, borderRadius: 6, background: 'transparent', font: '12px/1 var(--font)', color: 'var(--muted)', cursor: 'pointer' }}>Changes</button>
      </div>
      {f && <LayerFields f={f} />}
    </>
  );
}

function LayerFields({ f }: { f: Found }) {
  const { state, brand, edit, go } = useEditor();
  const r = state.clip.recipe;
  const l = f.layer;
  const start = sceneStart(r, f.si);
  const set = (key: string, value: unknown, summary: string) => edit(setField(findLayer(r, f.scene.id, l.id)!, key, value, summary));

  const colourKey = l.type === 'text' ? 'colour' : l.type === 'shape' ? 'fill' : l.type === 'chart' ? 'colour' : undefined;
  const colour = l.type === 'text' ? l.colour : l.type === 'shape' ? l.fill : l.type === 'chart' ? l.colour : undefined;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>{`${TYPE[l.type]} · Scene ${f.si + 1}`}</span>
      </div>
      {l.type === 'text' && (
        <>
          <Labelled name="Text"><input value={l.text} onChange={(e) => set('text', e.target.value, `${l.name} text`)} style={field} /></Labelled>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            <Labelled name="Font">
              <select value={l.font} onChange={(e) => set('font', e.target.value, `${l.name} font ${e.target.value}`)} style={{ ...field, padding: '0 6px' }}>
                {fontOptions(r, brand, l.font).map(([family, text]) => <option key={family} value={family}>{text}</option>)}
              </select>
            </Labelled>
            <Labelled name="Size"><SizeInput value={l.sizePx} onCommit={(v) => set('sizePx', v, `${l.name} size ${v}`)} /></Labelled>
          </div>
        </>
      )}
      {colourKey && colour && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={label}>Colour</span>
          <Swatches value={colour} onPick={(hex) => set(colourKey, hex, `${l.name} colour ${hex}`)} />
        </div>
      )}
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', paddingTop: 4 }}>Motion</span>
      {SLOTS.map(([slot, text]) => (
        <button key={slot} type="button" data-slot={slot} onClick={() => go('Presets', { sceneId: f.scene.id, layerId: l.id, slot })}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 36, padding: '0 10px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', color: 'var(--ink)', font: '13px/1 var(--font)', cursor: 'pointer' }}>
          <span style={{ color: 'var(--muted)' }}>{text}</span><span style={{ fontWeight: 600 }}>{motionLabel(l[slot])}</span>
        </button>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <Labelled name="Starts"><TimeInput value={start + l.startMs} onCommit={(ms) => edit(setTiming(f, ms - start, l.endMs, `${l.name} ${clock(ms)}–${clock(start + l.endMs)}`))} /></Labelled>
        <Labelled name="Ends"><TimeInput value={start + l.endMs} onCommit={(ms) => edit(setTiming(f, l.startMs, ms - start, `${l.name} ${clock(start + l.startMs)}–${clock(ms)}`))} /></Labelled>
      </div>
    </>
  );
}

function fontOptions(r: ReturnType<typeof useEditor>['state']['clip']['recipe'], brand: ReturnType<typeof useEditor>['brand'], current: string): [string, string][] {
  const out = new Map<string, string>();
  for (const fam of [brand?.headingFont, brand?.bodyFont]) if (fam) out.set(fam, `${fam} (brand)`);
  for (const a of Object.values(r.assets)) if (a.kind === 'font' && !out.has(a.name)) out.set(a.name, a.name);
  for (const s of r.scenes) for (const l of s.layers) if (l.type === 'text' && !out.has(l.font)) out.set(l.font, l.font);
  if (!out.has(current)) out.set(current, current);
  if (!out.has('Geist')) out.set('Geist', 'Geist');
  return [...out];
}

function SizeInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const el = useRef<HTMLInputElement>(null);
  // Undo and redo change the size underneath; follow them unless someone is typing here.
  useEffect(() => { if (document.activeElement !== el.current) setText(String(value)); }, [value]);
  const commit = (t: string) => {
    const v = Math.round(Number(t));
    if (Number.isFinite(v) && v >= 8 && v <= 600) { if (v !== value) onCommit(v); } else setText(String(value));
  };
  return <input ref={el} inputMode="numeric" value={text} onChange={(e) => { setText(e.target.value); if (/^\d+$/.test(e.target.value) && Number(e.target.value) >= 8) commit(e.target.value); }} onBlur={(e) => commit(e.target.value)} style={mono} />;
}

function TimeInput({ value, onCommit }: { value: number; onCommit: (ms: number) => void }) {
  const [text, setText] = useState<string>();
  const commit = (t: string) => {
    const ms = parseClock(t);
    if (ms !== undefined && ms !== value) onCommit(ms);
    setText(undefined);
  };
  return (
    <input value={text ?? clock(value)} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setText(undefined); }} style={mono} />
  );
}

function Swatches({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const { state, brand } = useEditor();
  const picker = useRef<HTMLInputElement>(null);
  const brandHex = (brand?.colours ?? []).map((c) => ({ hex: c.hex.toUpperCase(), name: `Brand ${c.role}` }));
  const rest = clipColours(state.clip.recipe).filter((h) => !brandHex.some((b) => b.hex === h)).map((hex) => ({ hex, name: hex }));
  const list = [...brandHex, ...rest].slice(0, MAX_SWATCHES);
  const current = value.toUpperCase();
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {list.map((c) => {
        const on = c.hex === current;
        return <button key={c.hex + c.name} type="button" aria-label={c.name} aria-pressed={on} onClick={() => onPick(c.hex)}
          style={{ width: 26, height: 26, borderRadius: '50%', background: c.hex, border: on ? '2px solid var(--surface)' : '1px solid var(--line)', outline: on ? '2px solid var(--accent)' : 'none', cursor: 'pointer', padding: 0 }} />;
      })}
      <button type="button" aria-label="Other colour" onClick={() => picker.current?.click()} style={{ position: 'relative', width: 26, height: 26, borderRadius: '50%', background: 'var(--surface)', border: '1px dashed var(--faint)', cursor: 'pointer', padding: 0 }}>
        <input ref={picker} type="color" tabIndex={-1} aria-hidden="true" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(e) => onPick(e.target.value.toUpperCase())} style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }} />
      </button>
    </div>
  );
}
