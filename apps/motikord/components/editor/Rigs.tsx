import { useEffect, useState } from 'react';
import { layerStarts } from '@appskord/motion/choreo';
import { autoRig, boneLine, canRig, RIG_DEFAULTS, RIG_MOVES, rigOf, withRig, type BoneId, type RigSettings } from '@appskord/motion/rigs';
import type { LayerV3 } from '@appskord/motion/types';
import { useEditorV3 } from './context';
import { editScene } from './model';
import { C, Chip, Chips, hint, Section, Slider, SwitchRow } from './ui';

// Rig on the Layer tab: auto bones on a shape or SVG, a move per bone keyed into its tracks, squash and follow-through.

/** A shape's size when the recipe holds none, as the renderer draws it. */
export const RIG_SIZE = { w: 320, h: 200 } as const;
const BONES = autoRig(RIG_SIZE);
const NOTE = 'Rigs work on shapes and SVGs you add. Photos can’t be rigged.';

export function RigPanel({ layer }: { layer: LayerV3 }) {
  const ed = useEditorV3();
  const rig = rigOf(ed.scene.layers, layer.id, BONES);
  const [picked, setPicked] = useState<BoneId>();
  const [squash, setSquash] = useState<number>();
  // The recipe's squash wins again whenever it changes (undo, redo).
  useEffect(() => setSquash(undefined), [rig?.squash]);
  if (layer.id.includes('~')) return null;
  if (!canRig(layer)) return layer.kind === 'media' ? <p style={{ ...hint, margin: '12px 0 0' }}>{NOTE}</p> : null;
  const name = ed.name(layer);
  const save = (o: RigSettings, summary: string, mergeKey?: string) =>
    ed.update((st) => editScene(st, st.scene, (s) => {
      const start = layerStarts(s.layers)[s.layers.findIndex((l) => l.id === layer.id)] ?? 0;
      s.layers = withRig(s.layers, layer.id, BONES, o, start, s.ms);
    }, { summary: `${name}: ${summary}`, mergeKey }));
  const bone = BONES.find((b) => b.id === picked) ?? BONES.find((b) => rig?.moves[b.id]) ?? BONES[0]!;
  const amount = squash ?? rig?.squash ?? RIG_DEFAULTS.squash;
  return (
    <Section title="Rig" aside={`${name} · ${layer.kind}`}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ fontWeight: 600 }}>Add bones</span>
        {rig && <span style={{ color: C.muted }}>{`Auto rig found ${BONES.length}`}</span>}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Chip on={!!rig} onClick={() => save(rig ?? { ...RIG_DEFAULTS, squash: amount }, 'auto rig')}>Auto rig from shape</Chip>
        {/* Drawing bones needs joints dragged on the stage. */}
        <Chip on={false} disabled onClick={() => undefined}>Draw bones</Chip>
      </div>
      {rig && (
        <>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Bones</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {BONES.map((b) => (
              <button key={b.id} type="button" aria-pressed={b.id === bone.id} onClick={() => setPicked(b.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${b.id === bone.id ? 'var(--tint-line, #FBCFE8)' : C.line}`, background: b.id === bone.id ? C.tint : C.surface, color: C.ink, font: `500 12px/1 ${C.font}`, cursor: 'pointer' }}>
                <span style={{ fontWeight: 600 }}>{b.name}</span>
                <span style={{ color: C.muted }}>{boneLine(b, rig.moves[b.id])}</span>
              </button>
            ))}
          </div>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>Moves</span>
            <span style={{ color: C.muted }}>{`for ${bone.name}`}</span>
          </span>
          <Chips options={RIG_MOVES} value={rig.moves[bone.id]}
            onChange={(m) => {
              const moves = { ...rig.moves };
              if (moves[bone.id] === m) delete moves[bone.id];
              else moves[bone.id] = m;
              save({ ...rig, squash: amount, moves }, `${bone.name} ${RIG_MOVES.find(([id]) => id === m)![1]}`);
            }} />
          <Slider name="Squash and stretch" min={0} max={100} value={Math.round(amount * 100)} text={`${Math.round(amount * 100)}%`}
            onChange={(v) => {
              setSquash(v / 100);
              save({ ...rig, squash: v / 100 }, 'squash and stretch', `rig:${layer.id}:squash`);
            }} />
          <SwitchRow title="Follow-through" line="Arms and lid settle a beat after the body stops" on={rig.follow} onChange={(follow) => save({ ...rig, squash: amount, follow }, 'follow-through')} />
        </>
      )}
      <p style={{ ...hint, margin: 0 }}>{NOTE}</p>
    </Section>
  );
}
