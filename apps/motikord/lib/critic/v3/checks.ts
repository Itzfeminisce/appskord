// Quality check, the free part: checks read straight from the recipe before any AI pass, and the one fix each
// kind of note can make. Copy from the CriticV3 frame.
import type { SlotDef, SlotValue } from '@appskord/scenes';
import type { ClipV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import { getSceneTemplate } from '../../templates/scenes';
import type { Recipe } from '../../types';

export type PassId = 'story' | 'look' | 'motion';
export const PASSES: readonly { id: PassId; name: string }[] = [
  { id: 'story', name: 'Story' },
  { id: 'look', name: 'Same look throughout' },
  { id: 'motion', name: 'Look and motion' },
];

export type NoteKind = 'repeat' | 'words' | 'colour' | 'camera' | 'flat' | 'plastic' | 'generic' | 'stiff';
export const PASS_KINDS: Readonly<Record<PassId, readonly NoteKind[]>> = {
  story: ['repeat', 'words'],
  look: ['colour', 'camera'],
  motion: ['flat', 'plastic', 'generic', 'stiff'],
};

export interface QualityNote {
  pass: PassId;
  kind: NoteKind;
  sceneIndex: number;
  layerId?: string;
  /** The scene an earlier one repeats. */
  other?: number;
  problem: string;
  /** The second line under the problem, when the frame has one. */
  detail?: string;
  action: string;
  /** "Flat", "Plastic", "Generic", "Stiff timing". */
  tag?: string;
  by: 'check' | 'ai';
}

/** A note for scene `i` (from 0); `other` is the earlier scene a repeat matches. */
export function note(kind: NoteKind, i: number, by: QualityNote['by'], extra: { layerId?: string; other?: number; limit?: number; slot?: string; words?: number } = {}): QualityNote {
  const n = i + 1;
  const pass = (Object.keys(PASS_KINDS) as PassId[]).find((p) => PASS_KINDS[p].includes(kind))!;
  const base = { pass, kind, sceneIndex: i, by, ...(extra.layerId ? { layerId: extra.layerId } : {}) };
  switch (kind) {
    case 'repeat':
      return { ...base, other: extra.other, problem: `Scene ${n} repeats scene ${(extra.other ?? 0) + 1}’s point`, action: 'Merge scenes' };
    case 'words':
      const have = extra.words ?? 0;
      const limit = extra.limit ?? 0;
      return { ...base, problem: `Scene ${n} ${extra.slot ?? 'text'} is ${have - limit} words over its limit`, detail: `It has ${have} words. This slot fits ${limit}.`, action: 'Shorten it' };
    case 'colour':
      return { ...base, problem: `Scene ${n} uses a colour outside your look guide`, action: 'Use guide colour' };
    case 'camera':
      return { ...base, problem: `Scene ${n} camera is busier than the rest`, action: 'Calm the camera' };
    case 'flat':
      return { ...base, tag: 'Flat', problem: `Scene ${n} looks flat`, action: 'Add depth' };
    case 'plastic':
      return { ...base, tag: 'Plastic', problem: `Scene ${n} glow looks plastic`, action: 'Soften the glow' };
    case 'generic':
      return { ...base, tag: 'Generic', problem: `Scene ${n} could be any brand`, action: 'Make key word bigger' };
    case 'stiff':
      return { ...base, tag: 'Stiff timing', problem: `Scene ${n} lines land together`, action: 'Overlap the lines' };
  }
}

const wordList = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const slotText = (v: SlotValue | undefined): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : 'label' in x ? x.label : '')) : [];

function sceneWords(recipe: Recipe, i: number): string[] {
  const s = recipe.scenes[i]!;
  const fromSlots = Object.values(s.slots ?? {}).flatMap(slotText);
  const text = fromSlots.length ? fromSlots : s.layers.flatMap((l) => (l.type === 'text' ? [l.text] : []));
  return text.flatMap(wordList);
}

/** Two scenes that say the same thing: most of their words shared, and at least three of them. */
function repeats(recipe: Recipe): QualityNote[] {
  const out: QualityNote[] = [];
  const sets = recipe.scenes.map((_, i) => new Set(sceneWords(recipe, i)));
  sets.forEach((a, i) => {
    for (let j = 0; j < i; j++) {
      const b = sets[j]!;
      const shared = [...a].filter((w) => b.has(w)).length;
      if (shared >= 3 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.8) {
        out.push(note('repeat', i, 'check', { other: j }));
        return;
      }
    }
  });
  return out;
}

const slotWords = (v: SlotValue | undefined) => Math.max(0, ...slotText(v).map((s) => wordList(s).length));
const overLimit = (def: SlotDef, v: SlotValue | undefined) => def.words !== undefined && slotWords(v) > def.words;

function words(recipe: Recipe): QualityNote[] {
  return recipe.scenes.flatMap((s, i) => {
    const t = s.template ? getSceneTemplate(s.template) : undefined;
    const bad = t?.slots.find((d) => d.kind !== 'media' && d.kind !== 'logo' && overLimit(d, s.slots?.[d.id]));
    return bad ? [note('words', i, 'check', { layerId: bad.id, slot: bad.name.toLowerCase(), limit: bad.words, words: slotWords(s.slots?.[bad.id]) })] : [];
  });
}

const hex = (c: string) => c.trim().toUpperCase();
/** The look guide's colours plus the brand kit's, which still win. */
export const allowedColours = (look: LookGuide, brand: readonly string[] = []) =>
  new Set([...look.palette, ...brand, 'transparent'].map(hex));

/** Colours a scene's own layers use (text and shapes; media is the user's). */
export function sceneColours(recipe: Recipe, i: number): { layerId: string; colour: string }[] {
  return recipe.scenes[i]!.layers.flatMap((l) =>
    l.type === 'text' ? [{ layerId: l.id, colour: l.colour }] : l.type === 'shape' ? [{ layerId: l.id, colour: l.fill }] : [],
  );
}

function colours(recipe: Recipe, look: LookGuide, brand?: readonly string[]): QualityNote[] {
  const ok = allowedColours(look, brand);
  return recipe.scenes.flatMap((_, i) => {
    const off = sceneColours(recipe, i).find((c) => !ok.has(hex(c.colour)));
    return off ? [note('colour', i, 'check', { layerId: off.layerId })] : [];
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0;
};

/** A camera moving more than twice as far as the others, or the only orbit when the habit isn't one. */
function cameras(clip: ClipV3, look: LookGuide): QualityNote[] {
  if (clip.scenes.length < 3) return [];
  return clip.scenes.flatMap((s, i) => {
    const others = clip.scenes.filter((_, j) => j !== i);
    const m = median(others.map((o) => Math.abs(o.camera.amount)));
    const big = Math.abs(s.camera.amount) > Math.max(0.06, 2 * m);
    const lone = s.camera.move === 'orbit' && look.camera !== 'orbit' && !others.some((o) => o.camera.move === 'orbit');
    return big || lone ? [note('camera', i, 'check')] : [];
  });
}

const DEPTH_PROPS = ['z', 'blur', 'rotateY', 'extrude'] as const;
/** Flat: one depth for every layer, a still camera and nothing moving in depth. */
export function isFlat(s: SceneV3): boolean {
  if (s.layers.length < 2 || s.camera.move !== 'hold') return false;
  const one = s.layers.every((l) => l.depth === s.layers[0]!.depth);
  return one && !s.layers.some((l) => DEPTH_PROPS.some((p) => l.tracks[p]?.length) || l.z !== undefined);
}

const GLOW = new Set(['glow', 'bloom']);
export const PLASTIC_AMOUNT = 0.6;
const isPlastic = (s: SceneV3) => (s.effects ?? []).some((e) => GLOW.has(e.effect) && e.amount > PLASTIC_AMOUNT);

/** Stiff: two or more lines of text start on the same ms, with no per-word or per-letter stagger. */
export function stiffLines(s: SceneV3): string[] {
  const lines = s.layers.filter((l) => l.kind === 'text' && !l.type);
  const byStart = new Map<number, string[]>();
  for (const l of lines) byStart.set(l.start ?? 0, [...(byStart.get(l.start ?? 0) ?? []), l.id]);
  return [...byStart.values()].find((ids) => ids.length > 1) ?? [];
}

function motion(clip: ClipV3): QualityNote[] {
  return clip.scenes.flatMap((s, i) => [
    ...(isFlat(s) ? [note('flat', i, 'check')] : []),
    ...(isPlastic(s) ? [note('plastic', i, 'check')] : []),
    ...(stiffLines(s).length ? [note('stiff', i, 'check', { layerId: stiffLines(s)[1] })] : []),
  ]);
}

export interface CheckInput {
  recipe: Recipe;
  clip: ClipV3;
  look: LookGuide;
  brandColours?: readonly string[];
}

/** Every free check for one pass. */
export function runChecks(pass: PassId, x: CheckInput): QualityNote[] {
  if (pass === 'story') return [...repeats(x.recipe), ...words(x.recipe)];
  if (pass === 'look') return [...colours(x.recipe, x.look, x.brandColours), ...cameras(x.clip, x.look)];
  return motion(x.clip);
}
