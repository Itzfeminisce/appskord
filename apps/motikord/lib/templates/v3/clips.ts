// The 12 v3 clip templates (TemplatesListV3, specs #108): each a v3 recipe of v3 scene templates in one pack.
// Names, packs, scenes and lengths are FRAMES.md "v3 clip templates"; sample words are the frame's cards, else the
// scene template's own sample. Pure: the same template always builds the same clip.
import { expandScene, getPack, type BrandKit, type Scene, type TemplateId } from '@appskord/scenes';
import { validateClip } from '@appskord/motion/recipe';
import type { ClipV3 } from '@appskord/motion/types';
import { getPackV3, packFinish, packLook, type PackId } from '../../look/packs';
import { continuity } from '../../pipeline/v3/motion';
import { motionScene } from '../../pipeline/v3/keyFrames';
import type { ClipType, Recipe, SlotValue, StyleId } from '../../types';
import { getTemplateV3 } from './templates';

/** A caption style the captions panel offers ("pop" is "Word pop"). */
export type AutoCaptions = 'pop';

export interface ClipTemplateV3 {
  id: string;
  name: string;
  type: ClipType;
  packId: PackId;
  scenes: TemplateId[];
  lengthMs: number;
  /** Turns on Auto captions in this style when narration is added. */
  autoCaptions?: AutoCaptions;
  /** Words per scene that replace the scene template's sample, by scene index. */
  words?: Record<number, Record<string, SlotValue>>;
}

export const CLIP_TEMPLATES_V3: readonly ClipTemplateV3[] = [
  {
    id: 'fieldnote-launch',
    name: 'Fieldnote launch',
    type: 'promo',
    packId: 'studio',
    scenes: ['title-hook', 'hero', 'split', 'big-statement', 'end-card'],
    lengthMs: 18_000,
    words: { 0: { kicker: 'FIELDNOTE 2.0', headline: 'Notes that think ahead' } },
  },
  {
    id: 'customer-quote',
    name: 'Customer quote',
    type: 'quote',
    packId: 'soft',
    scenes: ['quote', 'hero', 'end-card'],
    lengthMs: 12_000,
    words: {
      0: { quote: 'The first coffee that tastes like a slow morning.', name: 'Ada Okafor', role: 'Regular, Morning shift' },
    },
  },
  {
    id: 'growth-chart',
    name: 'Growth chart',
    type: 'chart',
    packId: 'kinetic',
    scenes: ['big-statement', 'chart', 'stat-reveal', 'end-card'],
    lengthMs: 15_000,
    words: {
      0: { statement: '3× faster', highlight: '3×' },
      1: {
        bars: [
          { label: 'Q1', value: 1 },
          { label: 'Q2', value: 1.6 },
          { label: 'Q3', value: 2.2 },
          { label: 'Q4', value: 3 },
        ],
      },
    },
  },
  {
    id: 'logo-pop',
    name: 'Logo pop',
    type: 'logo',
    packId: 'gloss',
    scenes: ['logo-sting', 'end-card'],
    lengthMs: 6_000,
    words: { 0: { tagline: 'Make it bright' } },
  },
  {
    id: 'how-it-works',
    name: 'How it works',
    type: 'explainer',
    packId: 'clean',
    scenes: ['title-hook', 'steps', 'list', 'end-card'],
    lengthMs: 20_000,
    words: { 0: { headline: 'How it works.' } },
  },
  {
    id: 'morning-shift-drop',
    name: 'Morning shift drop',
    type: 'social',
    packId: 'bold',
    scenes: ['big-statement', 'hero', 'end-card'],
    lengthMs: 10_000,
    words: { 0: { statement: 'NEW BREW', highlight: 'BREW' }, 1: { line: 'Morning shift · Elm St' } },
  },
  {
    id: 'say-it-out-loud',
    name: 'Say it out loud',
    type: 'captions',
    packId: 'kinetic',
    scenes: ['big-statement', 'big-statement', 'big-statement', 'end-card'],
    lengthMs: 15_000,
    autoCaptions: 'pop',
    words: { 0: { statement: 'Three hundred cups,', highlight: 'hundred' } },
  },
  {
    id: 'quarterly-results',
    name: 'Quarterly results',
    type: 'chart',
    packId: 'corporate',
    scenes: ['title-hook', 'stat-reveal', 'chart', 'list', 'end-card'],
    lengthMs: 20_000,
    words: { 0: { kicker: 'Q3 · FIELDNOTE' }, 1: { number: '+24%', label: 'Active teams, quarter on quarter' } },
  },
  {
    id: 'glow-up',
    name: 'Glow up',
    type: 'promo',
    packId: 'playful',
    scenes: ['before-after', 'big-statement', 'end-card'],
    lengthMs: 12_000,
    words: { 0: { before: 'Same cart.', after: 'New look.' } },
  },
  {
    id: 'three-tips',
    name: 'Three tips',
    type: 'explainer',
    packId: 'bold',
    scenes: ['title-hook', 'list', 'split', 'big-statement', 'end-card'],
    lengthMs: 20_000,
    words: {
      0: { kicker: '3 TIPS', headline: 'FASTER' },
      1: { items: ['Pin your top note', 'Ask for next steps', 'Share in one tap'] },
    },
  },
  {
    id: 'weekend-pop-up',
    name: 'Weekend pop-up',
    type: 'social',
    packId: 'soft',
    scenes: ['title-hook', 'hero', 'split', 'end-card'],
    lengthMs: 14_000,
    words: {
      // The kicker takes 4 words, so the days and hours go on the hero.
      0: { kicker: 'Elm St Market', headline: 'Weekend pop-up.' },
      1: { headline: 'SAT · SUN · 8–2', line: 'Morning shift coffee cart' },
    },
  },
  {
    id: 'brand-story',
    name: 'Brand story',
    type: 'logo',
    packId: 'studio',
    scenes: ['big-statement', 'hero', 'logo-sting'],
    lengthMs: 10_000,
    words: { 2: { tagline: 'NOTES THAT THINK AHEAD' } },
  },
];

export const getClipTemplateV3 = (id: string): ClipTemplateV3 | undefined => CLIP_TEMPLATES_V3.find((t) => t.id === id);

const V2_STYLES: readonly string[] = ['clean', 'bold', 'playful', 'corporate'];

/** Scene lengths that add up to the template's length: equal 100 ms steps, the rest on the last scene. */
export function sceneLengths(t: ClipTemplateV3): number[] {
  const each = Math.floor(t.lengthMs / t.scenes.length / 100) * 100;
  return t.scenes.map((_, i) => (i === t.scenes.length - 1 ? t.lengthMs - each * i : each));
}

/** The words, layout and media slots behind the clip (a v2 recipe), in the pack's colours and fonts. */
export function clipTemplateRecipe(t: ClipTemplateV3, id: string = t.id): Recipe {
  const pack = getPackV3(t.packId);
  const style: StyleId = V2_STYLES.includes(t.packId) ? (t.packId as StyleId) : 'clean';
  // The four new packs have no v2 style: their colours and fonts go in as a brand kit over Clean.
  const kit: BrandKit | undefined =
    style === t.packId
      ? undefined
      : {
          colours: [
            { hex: pack.colours[0]!, role: 'background' },
            { hex: pack.colours[1]!, role: 'text' },
            { hex: pack.colours[2] ?? pack.colours[1]!, role: 'primary' },
          ],
          headingFont: pack.fonts.display.family,
          bodyFont: pack.fonts.text.family,
          useForNewClips: false,
        };
  const v2 = getPack(style)!;
  const ms = sceneLengths(t);
  const scenes: Scene[] = t.scenes.map((template, i) =>
    expandScene(
      {
        id: `sc${i + 1}`,
        durationMs: ms[i]!,
        background: v2.palette.bg,
        layout: 'center',
        layers: [],
        template,
        slots: { ...getTemplateV3(template)!.sample, ...t.words?.[i] },
      },
      v2,
      kit,
    ),
  );
  return { version: 2, id, name: t.name, type: t.type, aspect: '9:16', style, scenes, assets: {} };
}

/** The template's v3 clip: each scene's full motion in the pack, then the pack's continuity. Throws if invalid. */
export function clipTemplateV3(t: ClipTemplateV3, recipe: Recipe = clipTemplateRecipe(t)): ClipV3 {
  const pack = getPackV3(t.packId);
  const look = packLook(pack);
  const built = recipe.scenes.map((_, i) => motionScene(recipe, i, look, pack));
  const clip: ClipV3 = {
    version: 3,
    scenes: continuity(built, recipe, pack).scenes,
    lookGuideId: look.id,
    packId: pack.id,
    fps: 30,
    finish: packFinish(pack),
  };
  const checked = validateClip(clip);
  if (!checked.ok) throw new Error(`Motikord: could not build the ${t.name} template. ${checked.errors.join(' ')}`);
  return clip;
}

/** A library row made from a v3 clip template. */
export interface TemplateClipRow {
  v3: ClipV3;
  autoCaptions?: AutoCaptions;
}

/** The caption style a clip made from "Say it out loud" turns on when narration is added, if any. */
export const autoCaptionsOf = (clip: object): AutoCaptions | undefined =>
  (clip as Partial<TemplateClipRow>).autoCaptions;
