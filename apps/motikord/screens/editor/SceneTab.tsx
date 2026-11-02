import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clockShort, restTime, sceneIndex, sceneStart } from '../../lib/editor/store';
import { sceneTiming } from '../../lib/editor/timeline';
import {
  countLabel, defaultMs, packOf, setSlot, setTransition, slotCount, slotText, templateOf, transitionGroups, transitionOf,
  TRANSITION_NAMES,
} from '../../lib/editor/v2';
import type { Scene, SlotDef, SlotValue, TransitionKind } from '../../lib/types';
import { useEditor } from './Editor';
import { PanelTabs } from './PanelTabs';
import { SceneThumb, thumbSize } from './SceneThumb';
import { Spinner } from './StatesV2';

// EditorScene, Scene tab: template card, one field per slot with its word counter, Comes in from, Length, remake.
// SlotEditing: a slot over its limit shows the amber counter and note, and is shortened on blur.

const label = { fontSize: 12, color: 'var(--muted)' } as const;
const field = { minHeight: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', font: '13px/1.35 var(--font)', color: 'var(--ink)', background: 'var(--surface)', width: '100%', boxSizing: 'border-box', resize: 'vertical' } as const;
const quiet = { height: 30, padding: '0 10px', border: '1px solid var(--line-strong)', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)', font: '500 12px/1 var(--font)', cursor: 'pointer', flexShrink: 0 } as const;

export const TOO_LONG = 'Too long for this slot. Motikord shortens it when you click away, and you can undo it.';

export function SceneTab() {
  const { state } = useEditor();
  const r = state.clip.recipe;
  const si = sceneIndex(r, state.sceneId);
  const scene = r.scenes[si];
  return (
    <>
      <PanelTabs on="scene" />
      {scene && <SceneFields si={si} scene={scene} />}
    </>
  );
}

function SceneFields({ si, scene }: { si: number; scene: Scene }) {
  const { state, openPanel, openedPanel, remaking, remake } = useEditor();
  const swapping = openedPanel?.kind === 'swap' && openedPanel.sceneId === scene.id;
  const r = state.clip.recipe;
  const t = templateOf(scene);
  const start = sceneStart(r, si);
  const [ask, setAsk] = useState('');
  const busy = remaking === scene.id;
  const thumb = thumbSize(r.aspect, r.aspect === '16:9' ? 48 : 64);
  const { head, pair } = slotRows(t?.slots ?? []);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{`Scene ${si + 1}`}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)', flexShrink: 0 }}>{`${clockShort(start)}–${clockShort(start + scene.durationMs)}`}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={label}>Template</span>
        <div style={{ padding: 10, borderRadius: 12, border: '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <SceneThumb recipe={r} aspect={r.aspect} timeMs={restTime(r, si)} w={thumb.w} h={thumb.h} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flexGrow: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{t?.name ?? 'Free layers'}</span>
            {t && <span style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--muted)' }}>{t.line}</span>}
            <button type="button" onClick={() => openPanel({ kind: 'swap', sceneId: scene.id })} aria-expanded={swapping} style={{ ...quiet, alignSelf: 'flex-start', marginTop: 4, height: 28, borderRadius: 8, borderColor: '#E0E0E4', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', ...(swapping ? { outline: '2px solid var(--accent)', outlineOffset: 1, background: 'var(--tint)', color: 'var(--accent-hover)' } : {}) }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7h11l-3-3M17 17H6l3 3" /></svg>
              Swap template
            </button>
          </span>
        </div>
      </div>
      {head.map((d) => <SlotField key={d.id} si={si} scene={scene} def={d} />)}
      {pair.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
          {pair.map((d) => <SlotField key={d.id} si={si} scene={scene} def={d} />)}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: si > 0 ? 'minmax(0, 1.4fr) minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
        {si > 0 && <ComesIn si={si} />}
        <Labelled name="Length"><LengthInput si={si} /></Labelled>
      </div>
      <Labelled name="Tell it what to change (optional)">
        <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. make the number bigger and warmer" style={{ ...field, height: 34, padding: '0 10px' }} />
      </Labelled>
      <button type="button" className="btn btn-primary btn-block" disabled={!!remaking || !t} onClick={() => { remake(scene.id, ask); setAsk(''); }} style={{ gap: 8, height: 48, flexShrink: 0, borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
        {busy ? <Spinner colour="#fff" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>}
        {busy ? `Remaking scene ${si + 1}…` : 'Remake this scene'}
      </button>
      <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', marginTop: -4 }}>Keeps the other scenes as they are.</span>
    </>
  );
}

/** The last two short text slots share a row (Label and Source), so the remake button stays above the fold. */
export function slotRows(slots: SlotDef[]): { head: SlotDef[]; pair: SlotDef[] } {
  const fields = slots.filter((d) => d.kind === 'text' || d.kind === 'items');
  const tail = fields.slice(-2);
  const pairs = fields.length >= 3 && tail.every((d) => d.kind === 'text');
  return pairs ? { head: fields.slice(0, -2), pair: tail } : { head: fields, pair: [] };
}

function Labelled({ name, children }: { name: string; children: ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={label}>{name}</span>{children}</label>;
}

const isItems = (d: SlotDef) => d.kind === 'items';
const fromField = (d: SlotDef, text: string): SlotValue => (isItems(d) ? text.split('\n').map((s) => s.trim()).filter(Boolean) : text);

/** One slot: its text (items one per line) and "2 of 6 words"; over the limit it turns amber and waits for blur. */
function SlotField({ si, scene, def }: { si: number; scene: Scene; def: SlotDef }) {
  const { state, brand, edit, setNotice, openPanel } = useEditor();
  const stored = slotText(scene.slots?.[def.id]);
  const [draft, setDraft] = useState<string>();
  const text = draft ?? stored;
  const value = fromField(def, text);
  const c = slotCount(def, value);
  const counts = def.scale === 'number';

  const commit = (v: string) => {
    setDraft(undefined);
    if (JSON.stringify(fromField(def, v)) === JSON.stringify(scene.slots?.[def.id] ?? '')) return;
    const out = setSlot(state.clip.recipe, si, def.id, fromField(def, v), brand);
    if (!out || !edit(out.edit)) return;
    if (out.shortened) setNotice({ kind: 'text-shortened', original: slotText(fromField(def, v)) });
  };
  // The field keeps what was typed while focused; within the limit the stage follows live, merged into one Change.
  const change = (v: string) => {
    setDraft(v);
    if (slotCount(def, fromField(def, v)).over) return;
    const out = setSlot(state.clip.recipe, si, def.id, fromField(def, v), brand);
    if (out) edit(out.edit);
  };

  const Input = isItems(def) ? 'textarea' : 'input';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <label htmlFor={`slot-${def.id}`} style={label}>{def.name}</label>
        <span data-over={c.over || undefined} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.over ? 'var(--warning-ink)' : 'var(--faint)', fontWeight: c.over ? 600 : 400 }}>
          {counts ? 'counts up' : c.limit !== undefined ? countLabel(c.n, c.limit) : ''}
        </span>
      </span>
      <Input
        id={`slot-${def.id}`} value={text} rows={isItems(def) ? Math.max(3, text.split('\n').length) : undefined}
        onChange={(e) => change(e.target.value)} onBlur={(e) => commit(e.target.value)}
        style={isItems(def) ? field : { ...field, height: 34, padding: '0 10px' }}
        aria-invalid={c.over || undefined}
      />
      {c.over && (
        <div style={{ padding: 10, borderRadius: 9, background: 'var(--warning-bg)', border: '1px solid var(--warning-line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--warning-ink)' }}>{TOO_LONG}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => commit(text)} style={quiet}>Shorten now</button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => openPanel({ kind: 'swap', sceneId: scene.id })} style={quiet}>Swap template</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** "Comes in from": the pack's set first, then the others; "More" opens the TransitionPicker. */
function ComesIn({ si }: { si: number }) {
  const { state, edit } = useEditor();
  const r = state.clip.recipe;
  const cur = transitionOf(r, si);
  const g = transitionGroups(packOf(r));
  const set = (kind: TransitionKind) => edit(setTransition(r, si, { kind, ms: defaultMs(r, si) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor="comes-in" style={label}>Comes in from</label>
      <select id="comes-in" value={cur.kind} onChange={(e) => set(e.target.value as TransitionKind)} style={{ ...field, height: 34, padding: '0 8px' }}>
        {g.pack.map((k) => <option key={k} value={k}>{TRANSITION_NAMES[k]}</option>)}
        <optgroup label="Other transitions">{g.other.map((k) => <option key={k} value={k}>{TRANSITION_NAMES[k]}</option>)}</optgroup>
      </select>
    </div>
  );
}

/** "Length" in seconds. */
function LengthInput({ si }: { si: number }) {
  const { state, edit } = useEditor();
  const r = state.clip.recipe;
  const ms = r.scenes[si]!.durationMs;
  const [text, setText] = useState<string>();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setText(undefined), [ms]);
  const commit = (v: string) => {
    setText(undefined);
    const s = Number(v.replace(',', '.'));
    if (Number.isFinite(s) && s > 0) edit(sceneTiming(r, si, Math.round(s * 1000)));
  };
  return (
    <span style={{ height: 34, boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)', display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6 }}>
      <input ref={ref} aria-label="Length in seconds" inputMode="decimal" value={text ?? (ms / 1000).toFixed(1)}
        onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 'none', padding: 0, font: '13px/1 var(--mono)', color: 'var(--ink)', background: 'transparent' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>s</span>
    </span>
  );
}
