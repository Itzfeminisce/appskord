import { CAMERA_MOVES, DEPTHS, FEELS, LAYER_KINDS, LIGHTS, PROPS, UNITS } from './types';
import type { ClipV3, LookGuide, SceneV3 } from './types';

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const list = (xs: readonly string[]) => xs.join(', ');

const LAYER_KEYS = [
  'id',
  'kind',
  'depth',
  'z',
  'slotId',
  'tracks',
  'type',
  'carry',
  'seed',
  'start',
  'count',
  'particles',
];
const SCENE_KEYS = [
  'version',
  'id',
  'templateId',
  'ms',
  'layers',
  'camera',
  'transition',
  'keyFrameApproved',
  'effects',
  'depthBlur',
  'depthShadows',
];
const CLIP_KEYS = ['version', 'scenes', 'lookGuideId', 'packId', 'fps', 'finish', 'restyledFrom', 'effects'];
// Copies of the ids in particles.ts and effects.ts, which load three.js; recipe.test.ts keeps them equal.
export const PARTICLE_PRESET_IDS = ['confetti', 'sparks', 'dust', 'bubbles', 'snow', 'text-burst'] as const;
export const EFFECT_IDS = [
  'glass',
  'glow',
  'bloom',
  'depth-of-field',
  'dither',
  'distort',
  'chromatic',
  '3d-flip',
  'light-sweep',
  'grain',
  'halftone',
  'blur-in',
] as const;
const EFFECT_COLOURS = ['glow', 'light', 'ink'];
const EFFECT_SCOPES = ['layer', 'scene', 'clip'];
const PARTICLE_KEYS = ['preset', 'amount', 'size', 'speed', 'gravity', 'bounce', 'bake'];
const EFFECT_KEYS = ['effect', 'amount', 'colour', 'scope', 'sceneId', 'layerId'];
const FINISH_KEYS = ['on', 'blur', 'light', 'grain', 'grade'];

class Errors {
  readonly all: string[] = [];
  add(key: string, problem: string, fix: string): void {
    this.all.push(`${key}: ${problem}. ${fix}.`);
  }
  unknownKeys(o: Obj, known: readonly string[], at: string): void {
    for (const k of Object.keys(o))
      if (!known.includes(k)) this.add(`${at}${k}`, 'is not a recipe field', `Remove it, or use one of ${list(known)}`);
  }
  str(o: Obj, k: string, at: string, optional = false): void {
    if (optional && o[k] === undefined) return;
    if (typeof o[k] !== 'string' || o[k] === '')
      this.add(`${at}${k}`, 'is missing or not text', 'Set it to a non-empty string');
  }
  num(o: Obj, k: string, at: string, min: number, max: number, optional = false): void {
    if (optional && o[k] === undefined) return;
    const v = o[k];
    if (!isNum(v) || v < min || v > max)
      this.add(`${at}${k}`, `must be a number from ${min} to ${max}`, `Set it to a number in that range`);
  }
  bool(o: Obj, k: string, at: string, optional = false): void {
    if (optional && o[k] === undefined) return;
    if (typeof o[k] !== 'boolean') this.add(`${at}${k}`, 'is not true or false', 'Set it to true or false');
  }
  oneOf(o: Obj, k: string, at: string, allowed: readonly string[], what: string): void {
    if (!allowed.includes(o[k] as string))
      this.add(`${at}${k}`, `${JSON.stringify(o[k])} is not a ${what}`, `Use one of ${list(allowed)}`);
  }
}

function checkCurve(e: Errors, c: unknown, at: string): void {
  if (!isObj(c))
    return e.add(at, 'is not a curve', 'Use { kind: "bezier", p: [x1, y1, x2, y2] } or { kind: "spring", bounce, ms }');
  if (c.kind === 'bezier') {
    const p = c.p;
    if (!Array.isArray(p) || p.length !== 4 || !p.every(isNum))
      e.add(`${at}.p`, 'must be four numbers', 'Set it to [x1, y1, x2, y2]');
    else if ([p[0] as number, p[2] as number].some((x) => x < 0 || x > 1))
      e.add(`${at}.p`, 'has an x handle outside 0..1', 'Keep x1 and x2 between 0 and 1');
  } else if (c.kind === 'spring') {
    e.num(c, 'bounce', `${at}.`, 0, 95);
    e.num(c, 'ms', `${at}.`, 1, 10000);
  } else e.oneOf(c, 'kind', `${at}.`, ['bezier', 'spring'], 'curve kind');
}

function checkParticles(e: Errors, p: unknown, at: string): void {
  if (!isObj(p)) return e.add(at, 'is not particle settings', 'Use { preset, amount, size, speed, gravity, bounce }');
  const q = `${at}.`;
  e.unknownKeys(p, PARTICLE_KEYS, q);
  e.oneOf(p, 'preset', q, PARTICLE_PRESET_IDS, 'particle preset');
  e.num(p, 'amount', q, 0, 5000);
  e.num(p, 'size', q, 0, 200);
  e.num(p, 'speed', q, 0, 10);
  e.bool(p, 'gravity', q);
  e.bool(p, 'bounce', q);
  const b = p.bake;
  if (b === undefined) return;
  if (!isObj(b) || typeof b.key !== 'string' || !isNum(b.fps) || typeof b.data !== 'string')
    return e.add(`${q}bake`, 'is not a particle bake', 'Remove it so the particles bake again');
  if (!Array.isArray(b.counts) || !b.counts.every((c) => isNum(c) && c >= 0))
    e.add(`${q}bake.counts`, 'is not a list of counts', 'Remove the bake so the particles bake again');
}

/** Checks effect uses; `layers` are the scene's layer ids, absent at clip level. */
function checkEffects(e: Errors, list: unknown, at: string, layers?: readonly unknown[]): void {
  if (!Array.isArray(list)) return e.add(at, 'is not a list', 'Set it to a list of effects, or remove it');
  list.forEach((u: unknown, i) => {
    const p = `${at}[${i}].`;
    if (!isObj(u)) return e.add(`${at}[${i}]`, 'is not an effect', 'Use { effect, amount, scope }');
    e.unknownKeys(u, EFFECT_KEYS, p);
    e.oneOf(u, 'effect', p, EFFECT_IDS, 'known effect');
    e.num(u, 'amount', p, 0, 1);
    if (u.colour !== undefined) e.oneOf(u, 'colour', p, EFFECT_COLOURS, 'known effect colour');
    e.oneOf(u, 'scope', p, EFFECT_SCOPES, 'known effect scope');
    e.str(u, 'sceneId', p, true);
    e.str(u, 'layerId', p, true);
    if (u.scope === 'layer' && u.layerId === undefined)
      e.add(`${p}layerId`, 'is missing for a layer effect', 'Set it to the layer the effect is on');
    if (layers && typeof u.layerId === 'string' && !layers.includes(u.layerId))
      e.add(`${p}layerId`, `"${u.layerId}" is not a layer id in this scene`, 'Use a layer id from layers');
  });
}

function checkLayer(e: Errors, l: unknown, at: string): void {
  if (!isObj(l)) return e.add(at, 'is not a layer', 'Use an object with id, kind, depth and tracks');
  const p = `${at}.`;
  e.unknownKeys(l, LAYER_KEYS, p);
  e.str(l, 'id', p);
  e.oneOf(l, 'kind', p, LAYER_KINDS, 'layer kind');
  e.oneOf(l, 'depth', p, DEPTHS, 'depth');
  e.num(l, 'z', p, -100, 100, true);
  e.str(l, 'slotId', p, true);
  e.str(l, 'carry', p, true);
  e.num(l, 'seed', p, 0, 2 ** 32 - 1, true);
  e.num(l, 'start', p, 0, 600000, true);
  if (l.count !== undefined) {
    if (!isObj(l.count)) e.add(`${p}count`, 'is not count settings', 'Use { from, to, decimals? }');
    else {
      e.unknownKeys(l.count, ['from', 'to', 'decimals'], `${p}count.`);
      e.num(l.count, 'from', `${p}count.`, -1e12, 1e12);
      e.num(l.count, 'to', `${p}count.`, -1e12, 1e12);
      e.num(l.count, 'decimals', `${p}count.`, 0, 6, true);
    }
  }
  if (l.particles !== undefined) checkParticles(e, l.particles, `${p}particles`);
  if (l.type !== undefined) {
    if (!isObj(l.type)) e.add(`${p}type`, 'is not kinetic type settings', 'Use { unit: "letter" | "word" | "line" }');
    else e.oneOf(l.type, 'unit', `${p}type.`, UNITS, 'type unit');
  }
  if (!isObj(l.tracks)) return e.add(`${p}tracks`, 'is missing', 'Set it to an object of tracks, {} for a still layer');
  for (const [prop, track] of Object.entries(l.tracks)) {
    const tp = `${p}tracks.${prop}`;
    if (!(PROPS as readonly string[]).includes(prop)) {
      e.add(tp, 'is not an animatable property', `Use one of ${list(PROPS)}`);
      continue;
    }
    if (!Array.isArray(track) || track.length === 0) {
      e.add(tp, 'has no keys', 'Give it at least one { t, v } key or remove it');
      continue;
    }
    let last = -1;
    track.forEach((k: unknown, i) => {
      const kp = `${tp}[${i}]`;
      if (!isObj(k) || !isNum(k.t) || !isNum(k.v)) return e.add(kp, 'is not a key', 'Use { t: ms, v: number }');
      if (k.t < 0 || k.t <= last)
        e.add(`${kp}.t`, 'is not after the key before it', 'Sort keys by t, each later than the last');
      last = k.t;
      if (k.curve !== undefined) checkCurve(e, k.curve, `${kp}.curve`);
    });
  }
}

function checkScene(e: Errors, s: unknown, at: string): void {
  if (!isObj(s)) return e.add(at || 'scene', 'is not a scene', 'Use a SceneV3 object');
  const p = at ? `${at}.` : '';
  e.unknownKeys(s, SCENE_KEYS, p);
  if (s.version !== 3)
    e.add(`${p}version`, 'is not 3', 'Set version to 3, or load it as a v2 scene through @appskord/scenes');
  e.str(s, 'id', p);
  e.str(s, 'templateId', p);
  e.num(s, 'ms', p, 1, 600000);
  if (!Array.isArray(s.layers)) e.add(`${p}layers`, 'is missing', 'Set it to a list of layers');
  const layers = Array.isArray(s.layers) ? s.layers : [];
  layers.forEach((l, i) => checkLayer(e, l, `${p}layers[${i}]`));
  const ids = layers.map((l) => (isObj(l) ? l.id : undefined));
  ids.forEach((id, i) => {
    if (typeof id === 'string' && ids.indexOf(id) !== i)
      e.add(`${p}layers[${i}].id`, `"${id}" is used twice`, 'Give every layer its own id');
  });
  const cam = s.camera;
  if (!isObj(cam)) e.add(`${p}camera`, 'is missing', 'Set it to { move: "hold", amount: 0 }');
  else {
    e.unknownKeys(cam, ['move', 'amount', 'focus'], `${p}camera.`);
    e.oneOf(cam, 'move', `${p}camera.`, CAMERA_MOVES, 'camera move');
    e.num(cam, 'amount', `${p}camera.`, -1, 1);
    if (cam.focus !== undefined && !ids.includes(cam.focus))
      e.add(
        `${p}camera.focus`,
        `"${String(cam.focus)}" is not a layer id in this scene`,
        'Use a layer id from layers, or remove it',
      );
  }
  const tr = s.transition;
  if (!isObj(tr)) e.add(`${p}transition`, 'is missing', 'Set it to { kind: "cut" }');
  else {
    e.unknownKeys(tr, ['kind', 'carry'], `${p}transition.`);
    e.str(tr, 'kind', `${p}transition.`);
    const carries = layers.map((l) => (isObj(l) ? l.carry : undefined));
    if (tr.carry !== undefined) {
      if (!Array.isArray(tr.carry)) e.add(`${p}transition.carry`, 'is not a list', 'Set it to a list of carry ids');
      else
        tr.carry.forEach((c, i) => {
          if (!carries.includes(c))
            e.add(
              `${p}transition.carry[${i}]`,
              `"${String(c)}" is not a carry id of any layer`,
              'Set that carry id on a layer, or remove it',
            );
        });
    }
  }
  e.bool(s, 'keyFrameApproved', p, true);
  e.bool(s, 'depthShadows', p, true);
  if (s.depthBlur !== undefined) e.oneOf(s, 'depthBlur', p, ['nothing', 'soft'], 'depth blur');
  if (s.effects !== undefined) checkEffects(e, s.effects, `${p}effects`, ids);
}

function done<T>(e: Errors, value: unknown): Checked<T> {
  return e.all.length ? { ok: false, errors: e.all } : { ok: true, value: value as T };
}

/** Checks a v3 scene recipe. Every error names the key and the fix. */
export function validateScene(scene: unknown): Checked<SceneV3> {
  const e = new Errors();
  checkScene(e, scene, '');
  return done(e, scene);
}

/** Checks a v3 clip and all its scenes; carried ids must match a layer in the next scene. */
export function validateClip(clip: unknown): Checked<ClipV3> {
  const e = new Errors();
  if (!isObj(clip)) return { ok: false, errors: ['clip: is not a clip. Use a ClipV3 object.'] };
  e.unknownKeys(clip, CLIP_KEYS, '');
  if (clip.version !== 3)
    e.add('version', 'is not 3', 'Set version to 3, or load it as a v2 clip through @appskord/scenes');
  e.str(clip, 'lookGuideId', '');
  e.str(clip, 'packId', '');
  e.str(clip, 'restyledFrom', '', true);
  if (clip.fps !== 30 && clip.fps !== 60)
    e.add('fps', `${JSON.stringify(clip.fps)} is not a supported frame rate`, 'Use 30 or 60');
  const f = clip.finish;
  if (!isObj(f)) e.add('finish', 'is missing', 'Set it to { on: true, blur, light, grain, grade } with amounts 0..1');
  else {
    e.unknownKeys(f, FINISH_KEYS, 'finish.');
    if (typeof f.on !== 'boolean') e.add('finish.on', 'is not true or false', 'Set it to true or false');
    for (const k of ['blur', 'light', 'grain', 'grade']) e.num(f, k, 'finish.', 0, 1);
  }
  if (clip.effects !== undefined) checkEffects(e, clip.effects, 'effects');
  if (!Array.isArray(clip.scenes) || clip.scenes.length === 0)
    e.add('scenes', 'has no scenes', 'Add at least one SceneV3');
  const scenes = Array.isArray(clip.scenes) ? clip.scenes : [];
  scenes.forEach((s, i) => checkScene(e, s, `scenes[${i}]`));
  scenes.forEach((s, i) => {
    const next = scenes[i + 1];
    if (!isObj(s) || !isObj(s.transition) || !Array.isArray(s.transition.carry)) return;
    const nextCarries =
      isObj(next) && Array.isArray(next.layers) ? next.layers.map((l) => (isObj(l) ? l.carry : undefined)) : [];
    s.transition.carry.forEach((c, j) => {
      if (!nextCarries.includes(c))
        e.add(
          `scenes[${i}].transition.carry[${j}]`,
          `"${String(c)}" has no matching layer in the next scene`,
          'Set that carry id on a layer in the next scene, or remove it',
        );
    });
  });
  return done(e, clip);
}

/** Checks a look guide (the look bible). */
export function validateLookGuide(guide: unknown): Checked<LookGuide> {
  const e = new Errors();
  if (!isObj(guide)) return { ok: false, errors: ['lookGuide: is not a look guide. Use a LookGuide object.'] };
  e.unknownKeys(guide, ['id', 'name', 'palette', 'type', 'feel', 'light', 'texture', 'camera'], '');
  e.str(guide, 'id', '');
  e.str(guide, 'name', '');
  const pal = guide.palette;
  if (!Array.isArray(pal) || pal.length === 0 || !pal.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)))
    e.add('palette', 'is not a list of colours', 'Use hex colours such as "#1a1a2e"');
  if (!isObj(guide.type)) e.add('type', 'is missing', 'Set it to { display, text } font names');
  else {
    e.str(guide.type, 'display', 'type.');
    e.str(guide.type, 'text', 'type.');
  }
  e.oneOf(guide, 'feel', '', FEELS, 'motion feel');
  e.oneOf(guide, 'light', '', LIGHTS, 'light direction');
  e.num(guide, 'texture', '', 0, 1);
  e.oneOf(guide, 'camera', '', CAMERA_MOVES, 'camera move');
  return done(e, guide);
}
