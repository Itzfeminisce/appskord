// Turns a v3 template's layer plan into a SceneV3 in a pack. Pure: same template, pack and layers give the same scene.
import { getSceneTemplate } from '@appskord/scenes/templates/scenes';
import type { SlotDef } from '@appskord/scenes';
import { FEEL } from '@appskord/motion/curves';
import type { CameraV3, Curve, Key, LayerV3, SceneV3, Track } from '@appskord/motion/types';
import type { PackV3 } from '../../look/packs';
import type { LayerPlan, Move, TemplateV3 } from './templates';

type Tracks = LayerV3['tracks'];

const key = (t: number, v: number, curve?: Curve): Key<number> => (curve ? { t, v, curve } : { t, v });
const from = (a: number, b: number, ms: number, curve: Curve): Track<number> => [key(0, a), key(ms, b, curve)];

/** Keyframes for a move, starting at the layer's start. */
export function moveTracks(move: Move, ms: number, curve: Curve): Tracks {
  const fadeIn = from(0, 1, Math.round(ms * 0.6), curve);
  switch (move) {
    case 'fade':
      return { opacity: fadeIn };
    case 'rise':
      return { opacity: fadeIn, y: from(40, 0, ms, curve) };
    case 'fill':
      return { opacity: fadeIn, width: from(75, 100, ms, curve), scale: from(0.9, 1, ms, curve) };
    case 'wipe':
      return { mask: from(0, 1, ms, curve) };
    case 'draw':
      return { draw: from(0, 1, ms, curve) };
    case 'drop':
      return { opacity: from(0, 1, 80, curve), y: from(-600, 0, ms, curve) };
    case 'extrude':
      return { opacity: fadeIn, rotateY: from(-35, 0, ms, curve), z: from(-10, 0, ms, curve) };
    case 'orbit-in':
      return { opacity: fadeIn, rotate: from(-90, 0, ms, curve), scale: from(0, 1, ms, curve) };
    case 'morph':
      return { opacity: fadeIn, morph: from(0, 1, ms, curve) };
    case 'count':
      // draw is the count's progress: 0 shows 0, 1 shows the value from the data
      return { draw: from(0, 1, ms, curve) };
    case 'focus-in':
      return { opacity: fadeIn, blur: from(12, 0, ms, curve), z: from(-6, 0, ms, curve) };
    case 'scatter':
      return { opacity: fadeIn, rotate: from(-12, 0, ms, curve), y: from(120, 0, ms, curve) };
    case 'grow':
      return { draw: from(0, 1, ms, curve), opacity: fadeIn };
    case 'whip':
      return { opacity: fadeIn, x: from(-1080, 0, ms, curve), blur: from(16, 0, ms, curve) };
    case 'drift':
      return { opacity: fadeIn, y: from(0, -60, Math.max(ms, 3000), curve) };
  }
}

/** A curve's length: a spring's own ms, else the pack feel's. */
function curveMs(curve: Curve, pack: PackV3): number {
  return curve.kind === 'spring' ? curve.ms : FEEL[pack.feel].ms;
}

/** One layer the scene draws: a v2 layer (by id) filling a slot, or a layer the template adds. */
export interface LayerInput {
  id: string;
  slotId?: string;
  kind?: LayerV3['kind'];
}

/** The layers a template shows with nothing restyled into it: one per slot, then its own. */
export function templateLayers(t: TemplateV3): LayerInput[] {
  return t.plan.map((p) => (p.slot ? { id: p.id, slotId: p.id } : { id: p.id }));
}

const KIND: Record<SlotDef['kind'], LayerV3['kind']> = {
  text: 'text',
  items: 'text',
  media: 'media',
  chart: 'chart',
  logo: 'media',
};

// Repeated layers of one slot (list items, chart bars) start 80 ms apart, as the List card draws.
const ITEM_STEP_MS = 80;

function layerFrom(plan: LayerPlan, input: LayerInput, nth: number, pack: PackV3, seed: number): LayerV3 {
  const curve = plan.curve ?? pack.curve;
  const ms = plan.ms ?? curveMs(curve, pack);
  const layer: LayerV3 = {
    id: input.id,
    kind: input.kind ?? plan.kind,
    depth: plan.depth,
    start: Math.round(plan.at * 1000) + nth * ITEM_STEP_MS,
    tracks: moveTracks(plan.move, ms, curve),
  };
  if (plan.z !== undefined) layer.z = plan.z;
  if (input.slotId) layer.slotId = input.slotId;
  if (plan.unit) layer.type = plan.fill ? { unit: plan.unit, fill: true } : { unit: plan.unit };
  if (plan.carry && nth === 0) layer.carry = plan.carry;
  if (plan.particles) {
    layer.particles = { ...plan.particles };
    layer.seed = seed;
  }
  return layer;
}

/** Plan for a layer whose slot this template doesn't have (or a hand-made layer): it rises or fades in last. */
function loosePlan(t: TemplateV3, input: LayerInput, i: number): LayerPlan {
  // After the template's last beat; a scene with no template starts its layers 0.1 s apart.
  const last = t.plan.length ? Math.max(...t.plan.map((p) => p.at)) : -0.1;
  const kind = input.kind ?? 'text';
  return {
    id: input.id,
    kind,
    depth: kind === 'media' ? 'back' : 'front',
    at: last + 0.1 * (i + 1),
    move: kind === 'text' ? 'rise' : 'fade',
  };
}

/** Stable small number from a string, for particle seeds. */
function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The camera: the template's own move in its own pack, else the pack's camera habit. */
export function cameraFor(t: TemplateV3, pack: PackV3, layerIds: readonly string[]): CameraV3 {
  const base = t.packId === pack.id ? t.camera : { move: pack.camera.move, amount: pack.camera.amount };
  const focus = base.focus && layerIds.includes(base.focus) ? base.focus : undefined;
  if (base.move === 'rack-focus' && !focus) {
    const front = t.plan.find((p) => p.slot && p.kind === 'text' && layerIds.includes(p.id));
    return front ? { move: 'rack-focus', amount: 0, focus: front.id } : { move: 'hold', amount: 0 };
  }
  return focus ? { move: base.move, amount: base.amount, focus } : { move: base.move, amount: base.amount };
}

export interface SceneInput {
  id: string;
  ms?: number;
  /** The layers to animate; a template's own layers are always added. Defaults to one per slot. */
  layers?: LayerInput[];
}

/** A v3 scene for a template in a pack. Slot layers take the slot's plan; layers the template adds come after. */
export function buildScene(t: TemplateV3, pack: PackV3, input: SceneInput): SceneV3 {
  const v2 = getSceneTemplate(t.id);
  const given = input.layers ?? templateLayers(t).filter((l) => l.slotId);
  const counts = new Map<string, number>();
  const layers: LayerV3[] = given.map((l, i) => {
    const plan = (l.slotId && t.plan.find((p) => p.slot && p.id === l.slotId)) || loosePlan(t, l, i);
    const nth = counts.get(plan.id) ?? 0;
    counts.set(plan.id, nth + 1);
    const slot = v2?.slots.find((s) => s.id === l.slotId);
    const kind = l.kind ?? (slot ? KIND[slot.kind] : plan.kind);
    return layerFrom(plan, { ...l, kind }, nth, pack, hash(`${input.id}:${l.id}`));
  });
  // Plan id to the layer that answers to it (a slot's first layer, often a v2 layer id), for focus and effects.
  const byPlan = new Map<string, string>();
  for (const l of layers) if (l.slotId && !byPlan.has(l.slotId)) byPlan.set(l.slotId, l.id);
  const taken = new Set(layers.map((l) => l.id));
  for (const plan of t.plan) {
    if (plan.slot) continue;
    const id = taken.has(plan.id) ? `v3-${plan.id}` : plan.id;
    taken.add(id);
    byPlan.set(plan.id, id);
    layers.push(layerFrom(plan, { id }, 0, pack, hash(`${input.id}:${id}`)));
  }
  const alias = (planId: string) => byPlan.get(planId);
  const camera = cameraFor(t, pack, [...byPlan.keys()]);
  if (camera.focus) {
    const focus = alias(camera.focus);
    if (focus) camera.focus = focus;
    else delete camera.focus;
  }
  const carry = layers.flatMap((l) => (l.carry ? [l.carry] : []));
  const transition = t.transition === 'carry' && carry.length ? { kind: 'carry', carry } : { kind: t.transition };
  const scene: SceneV3 = {
    version: 3,
    id: input.id,
    templateId: t.id,
    ms: input.ms ?? v2?.defaultMs ?? 3000,
    layers,
    camera,
    transition,
  };
  const effects = (t.effects ?? []).flatMap((e) => {
    if (e.scope !== 'layer') return [{ ...e, sceneId: input.id }];
    const layerId = e.layerId && alias(e.layerId);
    return layerId ? [{ ...e, layerId, sceneId: input.id }] : [];
  });
  if (effects.length) scene.effects = effects;
  if (t.depthBlur) scene.depthBlur = t.depthBlur;
  if (t.depthShadows) scene.depthShadows = true;
  return scene;
}

/** Links scenes into a clip: a carry stays only when the next scene has a layer with the same carry id. */
export function linkScenes(scenes: SceneV3[]): SceneV3[] {
  return scenes.map((s, i) => {
    const next = new Set((scenes[i + 1]?.layers ?? []).flatMap((l) => (l.carry ? [l.carry] : [])));
    const carry = (s.transition.carry ?? []).filter((c) => next.has(c));
    if (carry.length) return { ...s, transition: { kind: 'carry', carry } };
    return { ...s, transition: { kind: s.transition.kind === 'carry' ? 'crossfade' : s.transition.kind } };
  });
}
