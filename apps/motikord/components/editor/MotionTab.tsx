import { FEEL } from '@appskord/motion/curves';
import type { Curve, LayerV3, SceneV3 } from '@appskord/motion/types';
import { useEditorV3 } from './context';
import { CurveEditor } from './CurveEditor';
import {
  carryInto, COMES_IN, dropCarry, FEEL_NAMES, FEEL_ORDER, feelOf, GOES_OUT, HOLDS, OVERLAP, parseMs, parseRange,
  rangeText, readMotion, writeMotion, type MotionSpec,
} from './edits';
import { editScenes, type V3State } from './model';
import { C, Chip, Chips, Field, PanelHead, Section, Segmented, Slider } from './ui';

// EditorMotion: comes in, feel and curve, timing, type moves, while on screen, goes out.

const WORD_WAITS = 'Each word waits for the last';

/** Writes a new motion spec for the layer; "Carry into next scene" also links the next scene's match. */
export function setMotion(st: V3State, layerId: string, spec: MotionSpec, summary: string, mergeKey?: string): V3State {
  return editScenes(
    st,
    (scenes) => {
      const s = scenes[st.scene]!;
      const j = s.layers.findIndex((l) => l.id === layerId);
      if (j < 0) return;
      const before = s.layers[j]!;
      if (before.carry && spec.out !== 'carry') dropCarry(scenes, st.scene, layerId);
      s.layers[j] = writeMotion(s, s.layers[j]!, spec);
      if (spec.out === 'carry') carryInto(scenes, st.scene, layerId);
    },
    { summary, mergeKey },
  );
}

export function MotionTab() {
  const ed = useEditorV3();
  const { scene, layer, state } = ed;
  if (!layer) return <p style={{ fontSize: 13, color: C.muted }}>Scene {state.scene + 1}</p>;
  return <MotionFor scene={scene} layer={layer} />;
}

function MotionFor({ scene, layer }: { scene: SceneV3; layer: LayerV3 }) {
  const ed = useEditorV3();
  const name = ed.name(layer);
  const spec = readMotion(scene, layer);
  const feel = feelOf(spec.curve);
  // "Reset to {feel}" goes back to the feel the layer had before its handles moved.
  if (feel) ed.feels.set(layer.id, feel);
  const had = ed.feels.get(layer.id) ?? ed.look.feel ?? 'smooth';
  const last = ed.state.scene >= ed.state.clip.v3.scenes.length - 1;
  const set = (patch: Partial<MotionSpec>, what: string, mergeKey?: string) =>
    ed.update((st) => setMotion(st, layer.id, { ...spec, ...patch }, `${name}: ${what}`, mergeKey));
  const text = layer.kind === 'text';
  const spring = spec.curve.kind === 'spring' ? spec.curve : undefined;
  const words = ed.text(layer);
  const tagged = (section: string) => ed.changed?.layerId === layer.id && ed.changed.scene === ed.state.scene && ed.changed.sections.includes(section);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHead icon="Tt" name={name} line={words ? `“${words.replace(/\s+/g, ' ')}”` : `Scene ${ed.state.scene + 1}`} />
      <Section title="Comes in" changed={tagged("Comes in")} aside={text ? 'Kinetic type' : undefined}>
        <Chips options={text ? COMES_IN : COMES_IN.filter(([id]) => id !== 'word' && id !== 'letter' && id !== 'fill')} value={spec.comesIn}
          disabled={!!layer.count} onChange={(v) => set({ comesIn: v }, COMES_IN.find(([id]) => id === v)![1])} />
      </Section>
      <Section title="Feel" changed={tagged("Feel")}>
        <Segmented name="Feel" options={FEEL_ORDER.map((f) => [f, FEEL_NAMES[f]] as const)} value={feel}
          onChange={(f) => set({ curve: FEEL[f].curve, ms: FEEL[f].ms }, FEEL_NAMES[f])} />
        <CurveEditor curve={spec.curve}
          onKind={(v) => {
            const curve: Curve = v === 'spring' ? { kind: 'spring', bounce: 20, ms: spec.ms } : FEEL.smooth.curve;
            set({ curve }, v === 'spring' ? `Spring · ${20}% bounce` : 'Curve');
          }}
          onCommit={(curve) => {
            const f = feelOf(curve);
            set({ curve }, curve.kind === 'spring' ? `Spring · ${curve.bounce}% bounce` : f ? FEEL_NAMES[f] : 'Curve');
          }}
          reset={feel ? undefined : { name: FEEL_NAMES[had], onReset: () => set({ curve: FEEL[had].curve, ms: FEEL[had].ms }, FEEL_NAMES[had]) }} />
        {spring && (
          <Slider name="Bounce" min={0} max={100} value={spring.bounce} text={`Spring · ${spring.bounce}% bounce`}
            onChange={(b) => set({ curve: { ...spring, bounce: b } }, `Spring · ${b}% bounce`, `${layer.id}:bounce`)} />
        )}
      </Section>
      <Section title="Timing" changed={tagged("Timing")} aside={layer.type?.unit === 'word' ? WORD_WAITS : undefined}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Field name="Starts" value={`${((layer.start ?? 0) / 1000).toFixed(2).replace(/0$/, '')} s`}
            onCommit={(v) => {
              const ms = parseMs(v);
              if (ms === undefined) return;
              ed.update((st) => editScenes(st, (scenes) => {
                const l = scenes[st.scene]!.layers.find((x) => x.id === layer.id)!;
                l.start = Math.max(0, Math.round(ms));
              }, { summary: `${name}: Starts ${(ms / 1000).toFixed(2)} s` }));
            }} />
          <Field name="Overlap" value={`${OVERLAP} ms`} />
          <Field name="Length" value={`${(spec.ms / 1000).toFixed(1)} s`}
            onCommit={(v) => { const ms = parseMs(v); if (ms !== undefined && ms > 0) set({ ms, curve: spring ? { ...spring, ms } : spec.curve }, `Length ${(ms / 1000).toFixed(1)} s`); }} />
        </div>
      </Section>
      {text && (
        <Section title="Type moves" changed={tagged("Type moves")} aside="Variable font">
          <div style={{ display: 'flex', gap: 8 }}>
            <Field name="Weight" value={rangeText(spec.weight ?? [400, 400])}
              onCommit={(v) => { const r = parseRange(v); if (r) set({ weight: r }, `Weight ${rangeText(r)}`); }} />
            <Field name="Width" value={rangeText(spec.width ?? [100, 100])}
              onCommit={(v) => { const r = parseRange(v); if (r) set({ width: r }, `Width ${rangeText(r)}`); }} />
          </div>
        </Section>
      )}
      <Section title="While on screen" changed={tagged("While on screen")}>
        <Segmented name="While on screen" options={HOLDS} value={spec.hold} onChange={(h) => set({ hold: h }, HOLDS.find(([id]) => id === h)![1])} />
      </Section>
      <Section title="Goes out" changed={tagged("Goes out")}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {GOES_OUT.map(([id, label]) => (
            <Chip key={id} on={spec.out === id} disabled={id === 'carry' && last}
              onClick={() => set({ out: spec.out === id ? 'none' : id }, label)}>{label}</Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}
