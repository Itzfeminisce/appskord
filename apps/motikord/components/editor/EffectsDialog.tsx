import { useEffect, useState } from 'react';
import {
  EFFECT_COLOURS, EFFECT_FILTERS, EFFECT_SCOPES, EFFECTS, EFFECTS_NOTE, effectTracks,
  type EffectColour, type EffectId, type EffectScope, type EffectUse,
} from '@appskord/motion/effects';
import { useEditorV3 } from './context';
import { editClipEffects, editScene, type V3State } from './model';
import { C, hint, primaryButton, Slider } from './ui';

// EffectsLibrary and EffectDetails: 12 effects, each with its line and starting amount, added to a layer, scene or clip.

/** "Glow added to Headline": the use goes on the scene (layer or scene scope) or the clip. Motion effects write tracks. */
export function addEffect(st: V3State, use: EffectUse, target: string): V3State {
  const name = EFFECTS.find((e) => e.id === use.effect)!.name;
  const summary = `${name} added to ${target}`;
  if (use.scope === 'clip') return editClipEffects(st, [...(st.clip.v3.effects ?? []), use], { summary });
  return editScene(st, st.scene, (s) => {
    s.effects = [...(s.effects ?? []), { ...use, sceneId: s.id }];
    const tracks = use.scope === 'layer' ? effectTracks(use) : null;
    const l = tracks && s.layers.find((x) => x.id === use.layerId);
    if (l && tracks) Object.assign(l.tracks, tracks);
  }, { summary });
}

export function EffectsDialog({ onPreview }: { onPreview?: (effect: EffectId | undefined) => void }) {
  const ed = useEditorV3();
  const { layer, scene, state } = ed;
  const [filter, setFilter] = useState<(typeof EFFECT_FILTERS)[number]>('All');
  const [picked, setPicked] = useState<EffectId>();
  const entry = EFFECTS.find((e) => e.id === picked);
  const [amount, setAmount] = useState(0.5);
  const [colour, setColour] = useState<EffectColour>('glow');
  const [scope, setScope] = useState<EffectScope>(layer ? 'layer' : 'scene');
  const pick = (id: EffectId) => {
    setPicked(id);
    setAmount(EFFECTS.find((e) => e.id === id)!.amount);
    onPreview?.(id);
  };
  const close = () => { onPreview?.(undefined); ed.setOverlay(undefined); };
  // However the dialog goes away, the preview goes with it.
  useEffect(() => () => onPreview?.(undefined), [onPreview]);
  const target = scope === 'layer' && layer ? ed.name(layer) : scope === 'scene' ? `scene ${state.scene + 1}` : state.clip.recipe.name;
  const add = () => {
    if (!entry) return;
    const use: EffectUse = { effect: entry.id, amount, scope, ...(entry.colour ? { colour } : {}), ...(scope === 'layer' && layer ? { layerId: layer.id } : {}), ...(scope !== 'clip' ? { sceneId: scene.id } : {}) };
    ed.update((st) => addEffect(st, use, target));
    close();
  };
  const shown = EFFECTS.filter((e) => filter === 'All' || e.group === filter);
  return (
    <section role="dialog" aria-labelledby="fx-title" style={{ position: 'absolute', left: 680, top: 58, width: 676, maxWidth: 'calc(100% - 16px)', boxSizing: 'border-box', padding: '14px 16px 12px', borderRadius: 16, background: C.surface, border: '1px solid #E8E8EB', boxShadow: '0 24px 64px rgba(16,16,20,0.22), 0 2px 6px rgba(16,16,20,0.08)', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span id="fx-title" style={{ fontSize: 15, fontWeight: 600 }}>Effects</span>
        {layer && <span style={{ fontSize: 12, color: C.muted }}>{`for ${ed.name(layer)}`}</span>}
        <span style={{ fontSize: 11, color: C.muted, padding: '2px 6px', borderRadius: 6, background: C.stage }}>{EFFECTS.length}</span>
        <span style={{ flex: 1 }} />
        <button type="button" aria-label="Close effects" onClick={close} style={{ width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div role="group" aria-label="Filter effects" style={{ display: 'flex', gap: 6 }}>
            {EFFECT_FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={f === filter} onClick={() => setFilter(f)}
                style={{ height: 28, padding: '0 10px', borderRadius: 14, border: `1px solid ${f === filter ? '#111114' : '#E8E8EB'}`, background: f === filter ? '#111114' : C.surface, color: f === filter ? '#FFFFFF' : C.ink, font: '500 12px/1 inherit', cursor: 'pointer' }}>{f}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {shown.map((e) => (
              <button key={e.id} type="button" aria-pressed={e.id === picked} onClick={() => pick(e.id)}
                style={{ height: 72, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'flex-start', padding: 8, borderRadius: 10, border: `1px solid ${e.id === picked ? '#BE185D' : '#E8E8EB'}`, background: e.id === picked ? C.tint : C.surface, font: '600 12px/1.2 inherit', cursor: 'pointer' }}>
                <span style={{ fontSize: 10, fontWeight: 500, color: C.muted }}>{e.group}</span>
                {e.name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entry ? (
            <>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{entry.name}</span>
                <span style={hint}>{entry.line}</span>
              </span>
              <Slider name="Amount" min={0} max={100} value={Math.round(amount * 100)} text={`${Math.round(amount * 100)}%`} onChange={(v) => setAmount(v / 100)} />
              {entry.colour && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12, color: C.muted }}>Colour from look guide</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {EFFECT_COLOURS.map((c) => (
                      <button key={c.id} type="button" aria-label={c.label} aria-pressed={c.id === colour} onClick={() => setColour(c.id)}
                        style={{ height: 28, padding: '0 10px', borderRadius: 8, border: `1px solid ${c.id === colour ? '#BE185D' : '#E8E8EB'}`, background: c.id === colour ? C.tint : C.surface, font: '500 12px/1 inherit', cursor: 'pointer' }}>{c.label}</button>
                    ))}
                  </div>
                </div>
              )}
              <div role="radiogroup" aria-label="Apply to" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                <span style={{ color: C.muted }}>Apply to:</span>
                {EFFECT_SCOPES.filter((s) => s.id !== 'layer' || layer).map((s) => (
                  <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="radio" name="fx-scope" checked={scope === s.id} onChange={() => setScope(s.id)} />
                    {s.label}
                  </label>
                ))}
              </div>
              <button type="button" style={primaryButton} onClick={add}>{`Add ${entry.name.toLowerCase()} to ${target}`}</button>
            </>
          ) : (
            <p style={{ ...hint, margin: 0 }}>Pick an effect to see it on the stage before you add it.</p>
          )}
        </div>
      </div>
      <p style={{ ...hint, margin: 0 }}>{EFFECTS_NOTE}</p>
    </section>
  );
}
