import { useState } from 'react';
import type { SceneV3 } from '@appskord/motion/types';
import { TRANSITION_LABELS, type TransitionId } from '../../lib/look/packs';
import { useEditorV3 } from './context';
import { carryInto, FEEL_NAMES } from './edits';
import { editScenes, templateName, type V3State } from './model';
import { C, hint, primaryButton, Switch } from './ui';

// TransitionsV3: continuity transitions that carry things across, and the simple ones.

const CONTINUITY: readonly [TransitionId, string][] = [
  ['carry', 'The number becomes the first step'],
  ['shape-reveal', 'A shape opens onto the next scene'],
  ['mask-wipe', 'A soft edge wipes across'],
  ['match-cut', 'Same shape, new scene'],
  ['light-sweep', 'A band of light uncovers it'],
  ['whip-pan', 'A fast pan with motion blur'],
];
const SIMPLE: readonly TransitionId[] = ['cut', 'crossfade', 'slide', 'push'];

/** Sets the cut after scene `i`; "Carry over" links a matching layer pair. With `all`, every cut takes it where it can. */
export function setTransition(st: V3State, i: number, kind: TransitionId, all: boolean): V3State {
  return editScenes(
    st,
    (scenes) => {
      const at = all ? scenes.map((_, k) => k).slice(0, -1) : [i];
      for (const k of at) {
        const s = scenes[k]!;
        if (kind !== 'carry') {
          s.transition = { kind };
          continue;
        }
        const has = (s.transition.carry ?? []).length > 0;
        if (has) s.transition = { kind: 'carry', carry: s.transition.carry };
        else {
          const from = s.layers.find((l) => l.carry) ?? s.layers.find((l) => l.kind === 'text') ?? s.layers[0];
          if (from) carryInto(scenes, k, from.id);
        }
        if (s.transition.kind !== 'carry') s.transition = { kind: 'crossfade' };
      }
    },
    { summary: `Transition into scene ${i + 2}: ${TRANSITION_LABELS[kind]}` },
  );
}

/** "Number · “3 h”": the layers the cut carries. */
export function carried(s: SceneV3, name: (id: string) => string): string[] {
  const ids = new Set(s.transition.carry ?? []);
  return s.layers.filter((l) => l.carry && ids.has(l.carry)).map((l) => name(l.id));
}

export function TransitionDialog({ from }: { from: number }) {
  const ed = useEditorV3();
  const scenes = ed.state.clip.v3.scenes;
  const a = scenes[from]!;
  const b = scenes[from + 1];
  const [all, setAll] = useState(false);
  if (!b) return null;
  const kind = a.transition.kind as TransitionId;
  const pick = (k: TransitionId) => ed.update((st) => setTransition(st, from, k, all));
  const names = carried(a, (id) => {
    const l = a.layers.find((x) => x.id === id)!;
    const words = ed.text(l, from);
    return words ? `${ed.name(l, from)} · “${words.replace(/\s+/g, ' ')}”` : ed.name(l, from);
  });
  const chip = (k: TransitionId, line?: string) => (
    <button key={k} type="button" aria-pressed={kind === k} onClick={() => pick(k)}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, padding: 10, borderRadius: 10, border: `1px solid ${kind === k ? '#BE185D' : '#E8E8EB'}`, background: kind === k ? C.tint : C.surface, font: '600 12px/1.2 inherit', cursor: 'pointer', textAlign: 'left' }}>
      {TRANSITION_LABELS[k]}
      {line && <span style={{ fontWeight: 400, fontSize: 11, color: C.muted }}>{line}</span>}
    </button>
  );
  return (
    <div role="dialog" aria-label={`Transition into scene ${from + 2}`} style={{ position: 'absolute', left: '50%', bottom: 170, transform: 'translateX(-50%)', width: 560, maxWidth: 'calc(100% - 16px)', padding: 16, borderRadius: 16, background: C.surface, border: '1px solid #E8E8EB', boxShadow: '0 24px 64px rgba(16,16,20,0.22)', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{`Transition into scene ${from + 2}`}</span>
          <span style={hint}>{`From ${from + 1} · ${templateName(a)} to ${from + 2} · ${templateName(b)}`}</span>
        </span>
        <button type="button" aria-label="Close" onClick={() => ed.setOverlay(undefined)} style={{ width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>×</button>
      </div>
      <span style={{ fontSize: 12, fontWeight: 600 }}>Continuity <span style={{ fontWeight: 400, color: C.muted }}>Things carry across</span></span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {CONTINUITY.map(([k, line]) => chip(k, k === 'carry' ? (names.length ? undefined : line) : line))}
      </div>
      <span style={{ fontSize: 12, fontWeight: 600 }}>Simple</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>{SIMPLE.map((k) => chip(k))}</div>
      {kind === 'carry' && names.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: C.muted }}>What carries over</span>
          {names.map((n) => <span key={n} style={{ fontWeight: 600 }}>{n}</span>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
        {/* The recipe holds no transition length yet; it shows the look's. */}
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: C.muted }}>Length</span><span style={{ fontWeight: 600 }}>0.6 s</span></span>
          <input aria-label="Length" type="range" min={0.2} max={1} step={0.1} value={0.6} disabled readOnly />
          <span style={{ display: 'flex', justifyContent: 'space-between', color: C.muted }}><span>0.2 s</span><span>1.0 s</span></span>
        </label>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: C.muted }}>Feel</span>
          <span title="From your look guide" style={{ fontWeight: 600 }}>{FEEL_NAMES[ed.look.feel]} <span style={{ fontWeight: 400, color: C.muted }}>· look guide</span></span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Use for every cut in this clip</span>
        <Switch name="Use for every cut in this clip" on={all} onChange={(v) => { setAll(v); if (v) ed.update((st) => setTransition(st, from, kind, true)); }} />
      </div>
      {ed.state.clip.recipe.beatSync && <p style={{ ...hint, margin: 0 }}>Beat sync is on: the cut lands on the nearest beat.</p>}
      <button type="button" style={{ ...primaryButton, alignSelf: 'flex-end' }} onClick={() => ed.setOverlay(undefined)}>Done</button>
    </div>
  );
}
