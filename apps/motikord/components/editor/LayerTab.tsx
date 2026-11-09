import { useState } from 'react';
import { BEVEL_LABELS, GUIDE_LIGHT, lightLabel, MATERIAL_LABELS } from '@appskord/motion/light';
import { bakeParticles, PARTICLE_DEFAULTS, PARTICLE_LABELS, PARTICLE_PRESETS, type ParticleBake, type ParticleInput, type ParticleSettings } from '@appskord/motion/particles';
import type { SecondaryInput, SecondaryTracks } from '@appskord/motion/physics';
import type { LayerV3 } from '@appskord/motion/types';
import { useEditorV3 } from './context';
import { FLOOR, FRAME_SIZE, localEnd, wordBoxes } from './edits';
import { editLayer, editScene } from './model';
import { AssetDetails, assetOf } from './AssetPicker';
import { C, Chip, hint, PanelHead, Section, Segmented, Slider, SwitchRow } from './ui';

// Layer tab: Light 3D for words, Particles and physics for a particle layer, Physics for anything that can fall.

export interface Bakers {
  particles: (input: ParticleInput) => Promise<ParticleBake>;
  secondary: (input: SecondaryInput) => Promise<SecondaryTracks>;
}
// rapier's wasm loads only when a layer first falls.
const REAL: Bakers = { particles: bakeParticles, secondary: (input) => import('@appskord/motion/physics').then((m) => m.bakeSecondary(input)) };

export function LayerTab({ bakers = REAL }: { bakers?: Bakers }) {
  const { layer, state, scene } = useEditorV3();
  if (!layer) return <p style={{ fontSize: 13, color: C.muted }}>{`Scene ${state.scene + 1} layers`}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {layer.kind === 'particles' ? (
        <ParticlesPanel layer={layer} bake={bakers.particles} />
      ) : layer.kind === 'text' ? (
        <Light3D layer={layer} />
      ) : (
        <>
          {assetOf(layer) && <AssetDetails layer={layer} />}
          <PhysicsPanel layer={layer} bake={bakers.secondary} />
        </>
      )}
      <SceneLayers key={scene.id} />
    </div>
  );
}

/** "Scene 2 layers": every layer, a particle or physics layer marked saved once it is baked. */
function SceneLayers() {
  const ed = useEditorV3();
  const { scene, state } = ed;
  return (
    <Section title={`Scene ${state.scene + 1} layers`}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {scene.layers.map((l) => {
          const saved = !!l.particles?.bake || (l.kind !== 'particles' && l.kind !== 'text' && (l.tracks.y?.length ?? 0) > 10);
          return (
            <li key={l.id}>
              <button type="button" aria-pressed={l.id === state.layerId} onClick={() => ed.select(state.scene, l.id)}
                style={{ width: '100%', textAlign: 'left', height: 28, padding: '0 8px', border: 0, borderRadius: 6, background: l.id === state.layerId ? C.tint : 'transparent', color: C.ink, font: '500 12px/1 inherit', cursor: 'pointer' }}>
                {saved ? `${ed.name(l)} · saved` : ed.name(l)}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Light3D({ layer }: { layer: LayerV3 }) {
  const ed = useEditorV3();
  const name = ed.name(layer);
  const depth = layer.tracks.extrude?.[layer.tracks.extrude.length - 1]?.v ?? 0;
  const on = depth > 0;
  const dot = GUIDE_LIGHT[ed.look.light];
  const setDepth = (d: number, summary: string, mergeKey?: string) =>
    ed.update((st) => editLayer(st, layer.id, (l) => {
      if (d > 0) l.tracks.extrude = [{ t: 0, v: d }];
      else delete l.tracks.extrude;
    }, { summary, mergeKey }));
  return (
    <>
      <PanelHead icon="Aa" name={name} line={`Title text · scene ${ed.state.scene + 1}`} />
      <Section title="3D">
        <SwitchRow title="3D" line="Extruded, lit and shaded." on={on} onChange={(v) => setDepth(v ? 24 : 0, `${name}: 3D`)} />
        <Slider name="Depth" min={1} max={80} value={on ? depth : 24} text={String(on ? depth : 24)} disabled={!on}
          onChange={(v) => setDepth(v, `${name}: Depth ${v}`, `${layer.id}:extrude`)} />
        {/* Bevel, material and the light dot have no recipe field yet; they show the look's values. */}
        <span style={{ fontSize: 12, color: C.muted }}>Bevel</span>
        <Segmented name="Bevel" options={Object.entries(BEVEL_LABELS) as [string, string][]} value="soft" onChange={() => undefined} disabled />
        <span style={{ fontSize: 12, color: C.muted }}>Material</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.entries(MATERIAL_LABELS).map(([id, text]) => <Chip key={id} on={id === 'gloss'} disabled onClick={() => undefined}>{text}</Chip>)}
        </div>
        <div role="slider" aria-label="Light from" aria-valuetext={dot ? lightLabel(dot) : ''} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12, color: C.muted }}>Light from</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{dot ? lightLabel(dot) : ''}</span>
          <span style={hint}>Drag the dot to move the light.</span>
        </div>
        <SwitchRow title="Shadow" on={!!ed.scene.depthShadows}
          onChange={(v) => ed.update((st) => editScene(st, st.scene, (s) => { if (v) s.depthShadows = true; else delete s.depthShadows; }, { summary: `${name}: Shadow` }))} />
      </Section>
    </>
  );
}

const SPEED = (s: number) => `${s.toFixed(1)}×`;

function ParticlesPanel({ layer, bake }: { layer: LayerV3; bake: Bakers['particles'] }) {
  const ed = useEditorV3();
  const { scene, state } = ed;
  const saved = layer.particles ?? PARTICLE_DEFAULTS;
  const [draft, setDraft] = useState<ParticleSettings>({ ...PARTICLE_DEFAULTS, ...saved });
  const [busy, setBusy] = useState(false);
  const seed = layer.seed ?? 24;
  const name = ed.name(layer);
  /** Runs the particles once and saves settings and bake together, so undo takes both back. */
  const run = async (settings: ParticleSettings, nextSeed: number, summary: string) => {
    setDraft(settings);
    setBusy(true);
    try {
      const colliders = settings.bounce ? wordBoxes(scene, (l) => ed.text(l)) : [];
      const baked = await bake({ settings, seed: nextSeed, ms: localEnd(scene, layer), fps: state.clip.v3.fps, frame: FRAME_SIZE, colliders });
      ed.update((st) => editLayer(st, layer.id, (l) => { l.particles = { ...settings, bake: baked }; l.seed = nextSeed; }, { summary }));
    } catch (error) {
      console.error('Motikord: could not run the particles', error);
    } finally {
      setBusy(false);
    }
  };
  const change = (patch: Partial<ParticleSettings>, what: string) => void run({ ...draft, ...patch }, seed, `${name}: ${what}`);
  return (
    <>
      <PanelHead icon="✦" name={PARTICLE_LABELS[draft.preset]} line={`Particles · scene ${state.scene + 1}`} />
      <Section title="Particles and physics">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PARTICLE_PRESETS.map((p) => <Chip key={p} on={draft.preset === p} disabled={busy} onClick={() => change({ preset: p }, PARTICLE_LABELS[p])}>{PARTICLE_LABELS[p]}</Chip>)}
        </div>
        <Slider name="Amount" min={10} max={400} step={10} value={draft.amount} text={String(draft.amount)} disabled={busy}
          onChange={(v) => setDraft({ ...draft, amount: v })} onDone={() => change({}, `Amount ${draft.amount}`)} />
        <Slider name="Size" min={2} max={24} value={draft.size} text={`${draft.size} px`} disabled={busy}
          onChange={(v) => setDraft({ ...draft, size: v })} onDone={() => change({}, `Size ${draft.size} px`)} />
        <Slider name="Speed" min={0.2} max={3} step={0.1} value={draft.speed} text={SPEED(draft.speed)} disabled={busy}
          onChange={(v) => setDraft({ ...draft, speed: Math.round(v * 10) / 10 })} onDone={() => change({}, `Speed ${SPEED(draft.speed)}`)} />
        <SwitchRow title="Falls with gravity" on={draft.gravity} disabled={busy} onChange={(v) => change({ gravity: v }, 'Falls with gravity')} />
        <SwitchRow title="Bounces off text" line="Pieces hit the words and bounce off." on={draft.bounce} disabled={busy} onChange={(v) => change({ bounce: v }, 'Bounces off text')} />
        <Seed seed={seed} disabled={busy} onShuffle={() => void run(draft, seed + 1, `${name}: Seed ${seed + 1}`)} />
        <p style={{ ...hint, margin: 0 }}>
          Particles run once and are saved, so preview and export match. To drop a layer itself, turn on{' '}
          <span style={{ color: C.accent }}>Physics</span> in its Layer tab.
        </p>
      </Section>
    </>
  );
}

function Seed({ seed, onShuffle, disabled }: { seed: number; onShuffle: () => void; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: C.muted, flex: 1 }}>{`Seed ${seed}`}</span>
      <button type="button" disabled={disabled} onClick={onShuffle} style={{ height: 28, padding: '0 10px', border: '1px solid #E8E8EB', borderRadius: 7, background: '#FFFFFF', font: '500 12px/1 inherit', cursor: 'pointer' }}>Shuffle</button>
    </div>
  );
}

type LandsOn = 'words' | 'floor';
/** Recipe px/s² a falling layer drops with. */
export const GRAVITY = 2400;
/** A falling layer's box when the recipe holds no size. */
const BODY = 120;

function PhysicsPanel({ layer, bake }: { layer: LayerV3; bake: Bakers['secondary'] }) {
  const ed = useEditorV3();
  const { scene } = ed;
  const name = ed.name(layer);
  const on = (layer.tracks.y?.length ?? 0) > 10 && (layer.tracks.rotate?.length ?? 0) > 10;
  const [lands, setLands] = useState<LandsOn>('words');
  const [bounce, setBounce] = useState(40);
  const [spin, setSpin] = useState(20);
  const [busy, setBusy] = useState(false);
  const seed = layer.seed ?? 24;
  const run = async (o: { lands: LandsOn; bounce: number; spin: number; seed: number }, summary: string) => {
    setBusy(true);
    try {
      const colliders = [FLOOR, ...(o.lands === 'words' ? wordBoxes(scene, (l) => ed.text(l)) : [])];
      const x = layer.tracks.x?.[0]?.v ?? 0;
      const tracks = await bake({
        seed: o.seed, ms: localEnd(scene, layer), fps: ed.state.clip.v3.fps, gravity: GRAVITY, bounce: o.bounce / 100, colliders,
        bodies: [{ id: layer.id, x, y: -FRAME_SIZE.h / 2 - BODY, w: BODY, h: BODY, spin: o.spin * 3.6 }],
      });
      const moves = tracks[layer.id];
      if (!moves) return;
      ed.update((st) => editLayer(st, layer.id, (l) => { Object.assign(l.tracks, moves); l.seed = o.seed; }, { summary }));
    } catch (error) {
      console.error('Motikord: could not run the physics', error);
    } finally {
      setBusy(false);
    }
  };
  const again = (patch: Partial<{ lands: LandsOn; bounce: number; spin: number; seed: number }>, what: string) => {
    if (on) void run({ lands, bounce, spin, seed, ...patch }, `${name}: ${what}`);
  };
  return (
    <>
      {!assetOf(layer) && <PanelHead icon="◆" name={name} line={`Scene ${ed.state.scene + 1}`} />}
      <Section title="Physics">
        <SwitchRow title="Falls and settles" line="Drops in, bounces, then comes to rest." on={on} disabled={busy}
          onChange={(v) => {
            if (v) void run({ lands, bounce, spin, seed }, `${name}: Falls and settles`);
            else ed.update((st) => editLayer(st, layer.id, (l) => { delete l.tracks.x; delete l.tracks.y; delete l.tracks.rotate; l.tracks.opacity ??= [{ t: 0, v: 1 }]; }, { summary: `${name}: Falls and settles` }));
          }} />
        <span style={{ fontSize: 12, color: C.muted }}>Lands on</span>
        <Segmented name="Lands on" options={[['words', 'Words and floor'], ['floor', 'Floor only']] as const} value={lands} disabled={busy}
          onChange={(v) => { setLands(v); again({ lands: v }, v === 'words' ? 'Words and floor' : 'Floor only'); }} />
        <Slider name="Bounce" min={0} max={100} value={bounce} text={`${bounce}%`} disabled={busy} onChange={setBounce} onDone={() => again({}, `Bounce ${bounce}%`)} />
        <Slider name="Spin" min={0} max={100} value={spin} text={`${spin}%`} disabled={busy} onChange={setSpin} onDone={() => again({}, `Spin ${spin}%`)} />
        <Seed seed={seed} disabled={busy || !on} onShuffle={() => again({ seed: seed + 1 }, `Seed ${seed + 1}`)} />
        <p style={{ ...hint, margin: 0 }}>Physics runs once and is saved as moves, so preview and export match.</p>
      </Section>
    </>
  );
}
