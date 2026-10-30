import type { Aspect, Box, ClipType, Feel, LicenceId, Motion, Recipe } from '../types';

export const ASPECTS: readonly Aspect[] = ['9:16', '1:1', '16:9'];
export const CLIP_TYPES: readonly ClipType[] = ['promo', 'quote', 'chart', 'explainer', 'logo', 'captions', 'social'];
export const FEELS: readonly Feel[] = ['smooth', 'snappy', 'bouncy', 'steady'];
export const LICENCES: readonly LicenceId[] = ['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'pexels', 'own'];
const ASSET_KINDS = ['image', 'video', 'audio', 'font', 'logo'] as const;
const SOURCES = ['openverse', 'pexels', 'bundled', 'page'] as const;
const LAYER_TYPES = ['text', 'shape', 'image', 'video', 'chart'] as const;
// v1 clips are 60 seconds at most (PLAN.md open questions).
export const MAX_CLIP_MS = 60_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isText = (v: unknown): v is string => isStr(v) && v.trim() !== '';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = <T>(list: readonly T[], v: unknown): v is T => list.includes(v as T);
/** Hex colours only, plus "transparent" for see-through clips. */
export const isColour = (v: unknown): v is string => isStr(v) && (v === 'transparent' || /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v));

/**
 * Checks a value against Recipe. Returns problems in plain words; an empty list means the recipe is valid.
 * Pure: no browser, no I/O.
 */
export function validateRecipe(value: unknown): string[] {
  const problems: string[] = [];
  const bad = (msg: string) => problems.push(msg);
  if (!isObj(value)) return ['The recipe is not an object.'];
  const r = value;

  if (r.version !== 1) bad('The recipe version must be 1.');
  if (!isText(r.id)) bad('The recipe has no id.');
  if (!isStr(r.name)) bad('The recipe name must be text.');
  if (!oneOf(CLIP_TYPES, r.type)) bad(`The clip type must be one of ${CLIP_TYPES.join(', ')}.`);
  if (!oneOf(ASPECTS, r.aspect)) bad(`The size must be one of ${ASPECTS.join(', ')}.`);
  for (const key of ['brandApplied', 'creditsEndCard'] as const) {
    if (r[key] !== undefined && !isBool(r[key])) bad(`${key} must be true or false.`);
  }
  if (r.prompt !== undefined && !isStr(r.prompt)) bad('The prompt must be text.');

  const assets = isObj(r.assets) ? r.assets : undefined;
  if (!assets) bad('The recipe has no assets list.');
  for (const [key, a] of Object.entries(assets ?? {})) checkAsset(key, a, bad);
  const assetKind = (id: unknown) => (isStr(id) && assets && isObj(assets[id]) ? (assets[id] as Obj).kind : undefined);

  if (!Array.isArray(r.scenes) || r.scenes.length === 0) {
    bad('The recipe needs at least one scene.');
  } else {
    const ids = new Set<string>();
    const unique = (id: unknown, what: string) => {
      if (!isText(id)) return;
      if (ids.has(id)) bad(`${what} uses the id "${id}" twice.`);
      ids.add(id);
    };
    let total = 0;
    r.scenes.forEach((s: unknown, i) => {
      const at = `Scene ${i + 1}`;
      if (!isObj(s)) return bad(`${at} is not an object.`);
      if (!isText(s.id)) bad(`${at} has no id.`);
      unique(s.id, at);
      const duration = isNum(s.durationMs) && s.durationMs > 0 ? s.durationMs : undefined;
      if (duration === undefined) bad(`${at} must last longer than 0 ms.`);
      else total += duration;
      if (!isColour(s.background)) bad(`${at} background must be a hex colour or transparent.`);
      if (!isText(s.layout)) bad(`${at} has no layout.`);
      if (!Array.isArray(s.layers)) return bad(`${at} has no layers list.`);
      s.layers.forEach((l: unknown, j) => {
        const name = isObj(l) && isText(l.name) ? `"${l.name}"` : String(j + 1);
        const where = `${at}, layer ${name}`;
        if (!isObj(l)) return bad(`${where} is not an object.`);
        unique(l.id, where);
        checkLayer(where, l, duration, assetKind, bad);
      });
    });
    if (total > MAX_CLIP_MS) bad(`The clip is ${Math.round(total / 1000)} seconds long; the most is ${MAX_CLIP_MS / 1000}.`);
  }

  if (r.music !== undefined) {
    const m = r.music;
    if (!isObj(m)) bad('Music is not an object.');
    else {
      if (assetKind(m.assetId) !== 'audio') bad('Music must point to an audio file in the assets list.');
      if (!isNum(m.volume) || m.volume < 0 || m.volume > 1) bad('Music volume must be between 0 and 1.');
      if (!isNum(m.fadeInMs) || m.fadeInMs < 0) bad('Music fade in must be 0 ms or more.');
      if (!isNum(m.fadeOutMs) || m.fadeOutMs < 0) bad('Music fade out must be 0 ms or more.');
    }
  }
  return problems;
}

export function isRecipe(value: unknown): value is Recipe {
  return validateRecipe(value).length === 0;
}

function checkAsset(key: string, a: unknown, bad: (m: string) => void) {
  const at = `Asset "${key}"`;
  if (!isObj(a)) return bad(`${at} is not an object.`);
  if (a.id !== key) bad(`${at} must have the id "${key}".`);
  if (!oneOf(ASSET_KINDS, a.kind)) bad(`${at} kind must be one of ${ASSET_KINDS.join(', ')}.`);
  if (!isStr(a.name)) bad(`${at} name must be text.`);
  if (!isText(a.mime)) bad(`${at} has no file type.`);
  if (!isNum(a.bytes) || a.bytes < 0) bad(`${at} size must be 0 bytes or more.`);
  for (const k of ['width', 'height', 'durationMs'] as const) {
    if (a[k] !== undefined && (!isNum(a[k]) || (a[k] as number) <= 0)) bad(`${at} ${k} must be more than 0.`);
  }
  if (!isText(a.opfsPath)) bad(`${at} has no file path.`);
  if (a.credit === undefined) return;
  const c = a.credit;
  if (!isObj(c)) return bad(`${at} credit is not an object.`);
  if (!isStr(c.title)) bad(`${at} credit title must be text.`);
  if (!isStr(c.author)) bad(`${at} credit author must be text.`);
  if (!oneOf(SOURCES, c.source)) bad(`${at} credit source must be one of ${SOURCES.join(', ')}.`);
  if (!isStr(c.url)) bad(`${at} credit link must be text.`);
  if (!oneOf(LICENCES, c.licence)) bad(`${at} licence must be one of ${LICENCES.join(', ')}.`);
  if (c.licenceUrl !== undefined && !isStr(c.licenceUrl)) bad(`${at} licence link must be text.`);
}

function checkBox(where: string, b: unknown, bad: (m: string) => void) {
  if (!isObj(b)) return bad(`${where} has no position and size.`);
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    const v = b[k];
    if (!isNum(v) || v < 0 || v > 1) bad(`${where} ${k} must be a fraction of the canvas from 0 to 1.`);
  }
  if (isNum(b.w) && b.w === 0) bad(`${where} width must be more than 0.`);
  if (isNum(b.h) && b.h === 0) bad(`${where} height must be more than 0.`);
  if (b.rotation !== undefined && !isNum(b.rotation)) bad(`${where} rotation must be a number.`);
}

function checkMotion(where: string, m: unknown, bad: (m: string) => void) {
  if (m === undefined) return;
  if (!isObj(m)) return bad(`${where} is not an object.`);
  const motion = m as Partial<Motion>;
  if (!isText(motion.preset)) bad(`${where} has no preset.`);
  if (!oneOf(FEELS, motion.feel)) bad(`${where} feel must be one of ${FEELS.join(', ')}.`);
  if (!isNum(motion.durationMs) || motion.durationMs <= 0) bad(`${where} must last longer than 0 ms.`);
}

function checkLayer(
  where: string,
  l: Obj,
  sceneMs: number | undefined,
  assetKind: (id: unknown) => unknown,
  bad: (m: string) => void,
) {
  if (!isText(l.id)) bad(`${where} has no id.`);
  if (!isStr(l.name)) bad(`${where} name must be text.`);
  if (!oneOf(LAYER_TYPES, l.type)) return bad(`${where} type must be one of ${LAYER_TYPES.join(', ')}.`);
  if (!isNum(l.startMs) || l.startMs < 0) bad(`${where} must start at 0 ms or later.`);
  if (!isNum(l.endMs)) bad(`${where} has no end time.`);
  else if (isNum(l.startMs) && l.endMs <= l.startMs) bad(`${where} must end after it starts.`);
  else if (sceneMs !== undefined && l.endMs > sceneMs) bad(`${where} ends after its scene.`);
  checkBox(where, l.box, bad);
  if (l.boxes !== undefined) {
    if (!isObj(l.boxes)) bad(`${where} per-size positions are not an object.`);
    else for (const [aspect, b] of Object.entries(l.boxes)) {
      if (!oneOf(ASPECTS, aspect)) bad(`${where} has a position for an unknown size "${aspect}".`);
      else checkBox(`${where} at ${aspect}`, b as Box, bad);
    }
  }
  if (!isNum(l.opacity) || l.opacity < 0 || l.opacity > 1) bad(`${where} opacity must be between 0 and 1.`);
  checkMotion(`${where} "Comes in"`, l.in, bad);
  checkMotion(`${where} "While on screen"`, l.during, bad);
  checkMotion(`${where} "Goes out"`, l.out, bad);
  if (l.locked !== undefined && !isBool(l.locked)) bad(`${where} locked must be true or false.`);

  switch (l.type) {
    case 'text':
      if (!oneOf(['title', 'body', 'caption', 'label'], l.role)) bad(`${where} role must be title, body, caption or label.`);
      if (!isStr(l.text)) bad(`${where} text must be text.`);
      if (!isText(l.font)) bad(`${where} has no font.`);
      if (!isNum(l.sizePx) || l.sizePx <= 0) bad(`${where} text size must be more than 0.`);
      if (!isNum(l.weight) || l.weight < 100 || l.weight > 900) bad(`${where} weight must be from 100 to 900.`);
      if (!isColour(l.colour)) bad(`${where} colour must be a hex colour.`);
      if (!oneOf(['left', 'center', 'right'], l.align)) bad(`${where} align must be left, center or right.`);
      if (!isNum(l.lineHeight) || l.lineHeight <= 0) bad(`${where} line height must be more than 0.`);
      if (l.background !== undefined && !isColour(l.background)) bad(`${where} background must be a hex colour.`);
      break;
    case 'shape':
      if (!oneOf(['rect', 'circle', 'line'], l.shape)) bad(`${where} shape must be rect, circle or line.`);
      if (!isColour(l.fill)) bad(`${where} fill must be a hex colour.`);
      if (l.radius !== undefined && (!isNum(l.radius) || l.radius < 0)) bad(`${where} corner radius must be 0 or more.`);
      break;
    case 'image':
    case 'video': {
      const kind = assetKind(l.assetId);
      const fits = l.type === 'image' ? kind === 'image' || kind === 'logo' : kind === 'video';
      if (kind === undefined) bad(`${where} points to a file that is not in the assets list.`);
      else if (!fits) bad(`${where} points to a ${String(kind)} file, not a ${l.type}.`);
      if (!oneOf(['cover', 'contain'], l.fit)) bad(`${where} fit must be cover or contain.`);
      if (l.muted !== undefined && !isBool(l.muted)) bad(`${where} muted must be true or false.`);
      break;
    }
    case 'chart':
      if (!oneOf(['bar', 'line', 'number'], l.chart)) bad(`${where} chart must be bar, line or number.`);
      if (!Array.isArray(l.values) || l.values.length === 0) bad(`${where} needs at least one value.`);
      else if (!l.values.every((v) => isObj(v) && isStr(v.label) && isNum(v.value))) bad(`${where} values each need a label and a number.`);
      if (!isColour(l.colour)) bad(`${where} colour must be a hex colour.`);
      break;
  }
}
