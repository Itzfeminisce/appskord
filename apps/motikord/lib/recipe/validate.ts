import type { Aspect, Background, Box, ClipType, Feel, LicenceId, Mood, Motion, Pace, PresetSlot, Recipe, SlotKind, TransitionKind, TypeScale } from '../types';
import { getPreset } from '../render/presets';
import { isLayoutId, LAYOUTS } from '../render/reflow';
import { getSceneTemplate, isStyleId, SCENE_TEMPLATES, STYLE_PACKS } from '../templates/scenes';

export const ASPECTS: readonly Aspect[] = ['9:16', '1:1', '16:9'];
export const CLIP_TYPES: readonly ClipType[] = ['promo', 'quote', 'chart', 'explainer', 'logo', 'captions', 'social'];
export const FEELS: readonly Feel[] = ['smooth', 'snappy', 'bouncy', 'steady'];
export const LICENCES: readonly LicenceId[] = ['cc0', 'pdm', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'pexels', 'pixabay', 'unsplash', 'unknown', 'page', 'own', 'ai'];
const ASSET_KINDS = ['image', 'video', 'audio', 'font', 'logo'] as const;
const SOURCES = ['openverse', 'wikimedia', 'nasa', 'museums', 'ccmixter', 'pexels', 'pixabay', 'freesound', 'jamendo', 'unsplash', 'custom', 'bundled', 'page', 'ai'] as const;
export const PACES: readonly Pace[] = ['calm', 'normal', 'fast'];
export const MOODS: readonly Mood[] = ['upbeat', 'calm', 'warm', 'dramatic', 'none'];
export const TRANSITIONS: readonly TransitionKind[] = ['cut', 'crossfade', 'slide', 'push', 'wipe', 'zoom', 'match'];
const BG_KINDS = ['solid', 'gradient', 'blobs', 'blocks', 'grain'] as const;
const SLOT_KINDS: readonly SlotKind[] = ['text', 'items', 'media', 'chart', 'logo'];
const SCALES: readonly TypeScale[] = ['display', 'headline', 'body', 'caption', 'number'];
const ALIGNS = ['left', 'center', 'right'] as const;
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

  if (r.version !== 1 && r.version !== 2) bad('The recipe version must be 1 or 2.');
  if (!isText(r.id)) bad('The recipe has no id.');
  if (!isStr(r.name)) bad('The recipe name must be text.');
  if (!oneOf(CLIP_TYPES, r.type)) bad(`The clip type must be one of ${CLIP_TYPES.join(', ')}.`);
  if (!oneOf(ASPECTS, r.aspect)) bad(`The size must be one of ${ASPECTS.join(', ')}.`);
  for (const key of ['brandApplied', 'creditsEndCard'] as const) {
    if (r[key] !== undefined && !isBool(r[key])) bad(`${key} must be true or false.`);
  }
  if (r.prompt !== undefined && !isStr(r.prompt)) bad('The prompt must be text.');
  if (r.style !== undefined && !isStyleId(r.style)) bad(`The style must be one of ${STYLE_PACKS.map((p) => p.id).join(', ')}.`);
  if (r.pace !== undefined && !oneOf(PACES, r.pace)) bad(`The pace must be one of ${PACES.join(', ')}.`);
  if (r.mood !== undefined && !oneOf(MOODS, r.mood)) bad(`The music mood must be one of ${MOODS.join(', ')}.`);
  if (r.beatSync !== undefined && !isBool(r.beatSync)) bad('beatSync must be true or false.');
  if (r.beats !== undefined && (!Array.isArray(r.beats) || !r.beats.every((b) => isNum(b) && b >= 0))) bad('Beats must be a list of times of 0 ms or more.');

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
      else if (!isLayoutId(s.layout)) bad(`${at} layout must be one of ${LAYOUTS.join(', ')}.`);
      checkSceneV2(at, s, bad);
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
  if (c.sourceName !== undefined && !isStr(c.sourceName)) bad(`${at} credit source name must be text.`);
}

const isSlotValue = (v: unknown) =>
  isStr(v)
  || (isObj(v) && isText(v.assetId))
  || (Array.isArray(v) && (v.every(isStr) || v.every((b) => isObj(b) && isStr(b.label) && isNum(b.value))));

function checkSceneV2(at: string, s: Obj, bad: (m: string) => void) {
  const t = s.template === undefined ? undefined : getSceneTemplate(String(s.template));
  if (s.template !== undefined && !t) bad(`${at} template must be one of ${SCENE_TEMPLATES.map((x) => x.id).join(', ')}.`);
  for (const key of ['slots', 'original'] as const) {
    const v = s[key];
    if (v === undefined) continue;
    if (!isObj(v)) { bad(`${at} ${key} is not an object.`); continue; }
    for (const [id, value] of Object.entries(v)) {
      if (t && !t.slots.some((d) => d.id === id)) bad(`${at} has a slot "${id}" that ${t.name} does not have.`);
      if (!isSlotValue(value)) bad(`${at} slot "${id}" must be text, a list, a file or chart values.`);
    }
  }
  if (s.transition !== undefined) {
    const tr = s.transition;
    if (!isObj(tr)) bad(`${at} transition is not an object.`);
    else {
      if (!oneOf(TRANSITIONS, tr.kind)) bad(`${at} transition must be one of ${TRANSITIONS.join(', ')}.`);
      if (!isNum(tr.ms) || tr.ms < 0) bad(`${at} transition must last 0 ms or more.`);
    }
  }
  if (s.bg !== undefined) checkBackground(`${at} background`, s.bg, bad);
}

function checkBackground(where: string, b: unknown, bad: (m: string) => void) {
  if (!isObj(b)) return bad(`${where} is not an object.`);
  const bg = b as Partial<Background>;
  if (!oneOf(BG_KINDS, bg.kind)) bad(`${where} kind must be one of ${BG_KINDS.join(', ')}.`);
  if (!Array.isArray(bg.colours) || bg.colours.length === 0 || !bg.colours.every(isColour)) bad(`${where} needs one or more hex colours.`);
  if (bg.angle !== undefined && !isNum(bg.angle)) bad(`${where} angle must be a number.`);
  if (bg.grain !== undefined && (!isNum(bg.grain) || bg.grain < 0 || bg.grain > 1)) bad(`${where} grain must be between 0 and 1.`);
  if (bg.drift !== undefined && !isBool(bg.drift)) bad(`${where} drift must be true or false.`);
  if (bg.shapes !== undefined && (!isObj(bg.shapes) || !Object.values(bg.shapes).every((p) => Array.isArray(p) && p.every((pt) => Array.isArray(pt) && pt.length === 2 && pt.every(isNum))))) {
    bad(`${where} shapes must list [x, y] points for each size.`);
  }
}

/** Checks a style pack file (lib/templates/packs/<id>.json). An empty list means it is valid. */
export function validatePack(value: unknown): string[] {
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);
  if (!isObj(value)) return ['The style pack is not an object.'];
  const p = value;
  const at = `Style pack "${String(p.id)}"`;
  if (!isText(p.id)) bad('The style pack has no id.');
  if (!isText(p.name)) bad(`${at} has no name.`);
  const fonts = isObj(p.fonts) ? p.fonts : {};
  for (const k of ['display', 'text', 'number']) if (!isText(fonts[k])) bad(`${at} has no ${k} font.`);
  const pal = isObj(p.palette) ? p.palette : {};
  for (const k of ['bg', 'bg2', 'ink', 'muted', 'accent']) if (!isColour(pal[k])) bad(`${at} ${k} colour must be a hex colour.`);
  if (pal.accent2 !== undefined && !isColour(pal.accent2)) bad(`${at} accent2 colour must be a hex colour.`);
  if (p.label !== undefined && !(isObj(p.label) && isColour(p.label.bg) && isColour(p.label.ink))) bad(`${at} label needs a hex bg and ink colour.`);
  checkBackground(`${at} background`, p.background, bad);
  if (!oneOf(FEELS, p.feel)) bad(`${at} feel must be one of ${FEELS.join(', ')}.`);
  if (!isNum(p.motionMs) || p.motionMs <= 0) bad(`${at} motion must last longer than 0 ms.`);
  if (!Array.isArray(p.transitions) || p.transitions.length === 0 || !p.transitions.every((t) => oneOf(TRANSITIONS, t))) bad(`${at} transitions must be from ${TRANSITIONS.join(', ')}.`);
  if (!Array.isArray(p.clipTypes) || !p.clipTypes.every((t) => oneOf(CLIP_TYPES, t))) bad(`${at} clip types must be from ${CLIP_TYPES.join(', ')}.`);
  return problems;
}

/** Checks a scene template file (lib/templates/scenes/<id>.json). An empty list means it is valid. */
export function validateSceneTemplate(value: unknown): string[] {
  const problems: string[] = [];
  const bad = (m: string) => problems.push(m);
  if (!isObj(value)) return ['The scene template is not an object.'];
  const t = value;
  const at = `Template "${String(t.id)}"`;
  if (!isText(t.id)) bad('The scene template has no id.');
  for (const k of ['name', 'line', 'fits'] as const) if (!isText(t[k])) bad(`${at} has no ${k}.`);
  if (!isNum(t.defaultMs) || t.defaultMs <= 0) bad(`${at} must last longer than 0 ms.`);
  if (!Array.isArray(t.slots) || t.slots.length === 0) return [...problems, `${at} needs at least one slot.`];
  const ids = new Set<string>();
  t.slots.forEach((d: unknown, i) => {
    if (!isObj(d)) return bad(`${at} slot ${i + 1} is not an object.`);
    const where = `${at} slot "${String(d.id)}"`;
    if (!isText(d.id)) bad(`${at} slot ${i + 1} has no id.`);
    else if (ids.has(d.id)) bad(`${at} uses the slot id "${d.id}" twice.`);
    else ids.add(d.id);
    if (!isText(d.name)) bad(`${where} has no name.`);
    if (!oneOf(SLOT_KINDS, d.kind)) bad(`${where} kind must be one of ${SLOT_KINDS.join(', ')}.`);
    if (d.words !== undefined && (!Number.isInteger(d.words) || (d.words as number) < 1)) bad(`${where} word limit must be a whole number from 1.`);
    if (d.items !== undefined) {
      const it = d.items;
      if (!Array.isArray(it) || it.length !== 2 || !it.every((n) => Number.isInteger(n) && n >= 1) || it[0] > it[1]) bad(`${where} items must be a minimum and a maximum.`);
    }
    if (d.scale !== undefined && !oneOf(SCALES, d.scale)) bad(`${where} type scale must be one of ${SCALES.join(', ')}.`);
    if (d.align !== undefined && !oneOf(ALIGNS, d.align)) bad(`${where} align must be left, center or right.`);
    for (const k of ['optional', 'highlight'] as const) if (d[k] !== undefined && !isBool(d[k])) bad(`${where} ${k} must be true or false.`);
    if (!isObj(d.boxes)) bad(`${where} has no boxes.`);
    else for (const a of ASPECTS) checkBox(`${where} at ${a}`, d.boxes[a], bad);
    const m = isObj(d.motion) ? d.motion : undefined;
    if (!m) bad(`${where} has no motion.`);
    else {
      if (!isText(m.in) || getPreset(m.in)?.slot !== 'in') bad(`${where} "Comes in" preset "${String(m.in)}" is not a known in preset.`);
      if (m.during !== undefined && (!isText(m.during) || getPreset(m.during)?.slot !== 'during')) bad(`${where} "While on screen" preset "${String(m.during)}" is not a known during preset.`);
      if (m.stagger !== undefined && !oneOf(['word', 'line'], m.stagger)) bad(`${where} stagger must be word or line.`);
    }
  });
  return problems;
}

function checkBox(where: string, b: unknown, bad: (m: string) => void) {
  if (!isObj(b)) return bad(`${where} has no position and size.`);
  // x and y may sit off the canvas so a layer can start outside it; a line may have no height.
  for (const k of ['x', 'y'] as const) {
    const v = b[k];
    if (!isNum(v) || v < -1 || v > 2) bad(`${where} ${k} must be a fraction of the canvas from -1 to 2.`);
  }
  for (const k of ['w', 'h'] as const) {
    const v = b[k];
    if (!isNum(v) || v < 0 || v > 2) bad(`${where} ${k} must be a fraction of the canvas from 0 to 2.`);
  }
  if (isNum(b.w) && isNum(b.h) && b.w === 0 && b.h === 0) bad(`${where} must have a width or a height.`);
  if (b.rotation !== undefined && !isNum(b.rotation)) bad(`${where} rotation must be a number.`);
}

function checkMotion(where: string, slot: PresetSlot, m: unknown, bad: (m: string) => void) {
  if (m === undefined) return;
  if (!isObj(m)) return bad(`${where} is not an object.`);
  const motion = m as Partial<Motion>;
  if (!isText(motion.preset)) bad(`${where} has no preset.`);
  else if (getPreset(motion.preset)?.slot !== slot) bad(`${where} preset "${motion.preset}" is not a known ${slot} preset.`);
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
  checkMotion(`${where} "Comes in"`, 'in', l.in, bad);
  checkMotion(`${where} "While on screen"`, 'during', l.during, bad);
  checkMotion(`${where} "Goes out"`, 'out', l.out, bad);
  if (l.locked !== undefined && !isBool(l.locked)) bad(`${where} locked must be true or false.`);
  if (l.slot !== undefined && !isText(l.slot)) bad(`${where} slot must be text.`);

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
      if (l.pill !== undefined && !isBool(l.pill)) bad(`${where} pill must be true or false.`);
      if (l.letterSpacing !== undefined && !isNum(l.letterSpacing)) bad(`${where} letter spacing must be a number.`);
      if (l.highlight !== undefined && !(isObj(l.highlight) && Number.isInteger(l.highlight.word) && (l.highlight.word as number) >= 0 && isColour(l.highlight.colour))) bad(`${where} highlight needs a word number and a hex colour.`);
      if (l.shadow !== undefined && !isBool(l.shadow)) bad(`${where} shadow must be true or false.`);
      if (l.stagger !== undefined && !oneOf(['word', 'line'], l.stagger)) bad(`${where} stagger must be word or line.`);
      if (l.scaleAt !== undefined && !(isObj(l.scaleAt) && Object.entries(l.scaleAt).every(([k, v]) => oneOf(ASPECTS, k) && isNum(v) && v > 0))) bad(`${where} scaleAt needs a number above 0 for each size it names.`);
      if (l.valign !== undefined && l.valign !== 'top') bad(`${where} valign must be top.`);
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
      if (l.radius !== undefined && (!isNum(l.radius) || l.radius < 0)) bad(`${where} corner radius must be 0 or more.`);
      if (l.mask !== undefined && !oneOf(['rounded', 'circle', 'blob'], l.mask)) bad(`${where} mask must be rounded, circle or blob.`);
      if (l.border !== undefined && !isColour(l.border)) bad(`${where} border must be a hex colour.`);
      if (l.kenBurns !== undefined && !isBool(l.kenBurns)) bad(`${where} kenBurns must be true or false.`);
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
