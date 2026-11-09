// The 12 scene templates redrawn with v3 motion, copied from the TemplatesV3 frame. Slots and word limits stay the
// v2 template's (@appskord/scenes); a v3 template adds the pack it is shown in, the 4-beat motion and the layer plan.
import type { SlotValue, TemplateId } from '@appskord/scenes';
import type { CameraV3, Curve, Depth, LayerV3, Unit } from '@appskord/motion/types';
import type { EffectUse } from '@appskord/motion/effects';
import type { ParticleSettings } from '@appskord/motion/particles';
import type { PackId, TransitionId } from '../../look/packs';

/** How a layer enters; build.ts turns each into keyframes. */
export type Move =
  | 'fade'
  | 'rise'
  | 'fill'
  | 'wipe'
  | 'draw'
  | 'drop'
  | 'extrude'
  | 'orbit-in'
  | 'morph'
  | 'count'
  | 'focus-in'
  | 'scatter'
  | 'grow'
  | 'whip'
  | 'drift';

export interface LayerPlan {
  /** Slot id for a slot's layers, or the id of a layer the template adds (glass, blob, particles). */
  id: string;
  slot?: boolean;
  kind: LayerV3['kind'];
  depth: Depth;
  /** Seconds from the scene start, as the frame writes them. */
  at: number;
  move: Move;
  unit?: Unit;
  fill?: boolean;
  /** Overrides the pack's curve ("Spring · 20% bounce"). */
  curve?: Curve;
  /** Overrides the move's length. */
  ms?: number;
  z?: number;
  carry?: string;
  particles?: ParticleSettings;
  /** 3D text depth from, to; one value held when they match. */
  extrude?: [number, number];
  /** Fraunces SOFT axis from, to (0..100). */
  soft?: [number, number];
  /** A counting number: the layer's draw track is its progress. With `onto`, it counts to the number in that slot's text. */
  count?: { from: number; to?: number; decimals?: number };
  /** A backing panel: it sits behind these slots' text, sized to their block plus padding. */
  backs?: string[];
  /** Decor only: drawn at low contrast in this outline, and may sit behind text. */
  decor?: 'blob' | 'arch' | 'line';
  /** A text slot this layer's count runs on: that layer's own number counts up in place; nothing else is drawn. */
  onto?: string;
}
export interface Beat {
  /** Seconds, or null for "Out". */
  at: number | null;
  line: string;
}
export interface TemplateV3 {
  id: TemplateId;
  number: string;
  name: string;
  packId: PackId;
  /** "Key frame 0.9 s". */
  keyFrameS: number;
  /** The card's slot list as drawn: label and limit ("Kicker", "4 words"). */
  slotLabels: [string, string][];
  beats: Beat[];
  plan: LayerPlan[];
  camera: CameraV3;
  transition: TransitionId;
  effects?: Omit<EffectUse, 'sceneId'>[];
  depthBlur?: 'nothing' | 'soft';
  depthShadows?: boolean;
  /** The frame's sample words, by v2 slot id. */
  sample: Record<string, SlotValue>;
}

const spring = (bounce: number, ms = 700): Curve => ({ kind: 'spring', bounce, ms });
const STEADY: Curve = { kind: 'bezier', p: [0.45, 0, 0.55, 1] };
const SNAPPY: Curve = { kind: 'bezier', p: [0.2, 0, 0, 1] };
const FLOATY: Curve = { kind: 'bezier', p: [0.5, 0, 0.1, 1] };
const DRIFT: ParticleSettings = { preset: 'dust', amount: 40, size: 4, speed: 0.4, gravity: false, bounce: false };

/** Frame order 01 to 12. */
export const TEMPLATES_V3: readonly TemplateV3[] = [
  {
    id: 'title-hook',
    number: '01',
    name: 'Title hook',
    packId: 'studio',
    keyFrameS: 0.9,
    slotLabels: [
      ['Kicker', '4 words'],
      ['Headline', '6 words'],
    ],
    beats: [
      { at: 0, line: 'Light sweeps the glass, bloom on the edge' },
      { at: 0.2, line: 'Kicker slides up, Spring · 20% bounce' },
      { at: 0.35, line: 'Headline per word, 40 ms overlap, Push in 4%' },
      { at: null, line: 'Glass panel carries into the next scene' },
    ],
    plan: [
      { id: 'background', slot: true, kind: 'media', depth: 'back', at: 0, move: 'fade' },
      { id: 'glass', kind: 'shape', depth: 'back', at: 0, move: 'focus-in', z: -4, carry: 'glass', backs: ['kicker', 'headline'] },
      { id: 'kicker', slot: true, kind: 'text', depth: 'front', at: 0.2, move: 'rise', curve: spring(20) },
      { id: 'headline', slot: true, kind: 'text', depth: 'front', at: 0.35, move: 'rise', unit: 'word' },
    ],
    camera: { move: 'push-in', amount: 0.04, focus: 'headline' },
    transition: 'carry',
    effects: [
      { effect: 'light-sweep', amount: 0.5, colour: 'light', scope: 'layer', layerId: 'glass' },
      { effect: 'bloom', amount: 0.4, scope: 'scene' },
    ],
    sample: { kicker: 'Introducing Fieldnote 2.0', headline: 'Notes that organise themselves.' },
  },
  {
    id: 'big-statement',
    number: '02',
    name: 'Big statement',
    packId: 'kinetic',
    keyFrameS: 0.7,
    slotLabels: [
      ['Statement', '10 words'],
      ['Highlight', 'one word'],
    ],
    beats: [
      { at: 0, line: 'Lines rise through masks, 60 ms stagger' },
      { at: 0.3, line: '“before” scales to fill, width 75 to 100' },
      { at: 0.5, line: 'Pink block wipes in behind the highlight' },
      { at: null, line: 'Cut on the beat to the green ground' },
    ],
    plan: [
      { id: 'statement', slot: true, kind: 'text', depth: 'front', at: 0, move: 'wipe', unit: 'line' },
      { id: 'highlight', slot: true, kind: 'text', depth: 'front', at: 0.3, move: 'fill', unit: 'word', fill: true },
      { id: 'block', kind: 'shape', depth: 'middle', at: 0.5, move: 'wipe', z: -1, backs: ['highlight'] },
    ],
    camera: { move: 'hold', amount: 0 },
    transition: 'cut',
    sample: { statement: 'Great coffee, before your first meeting.', highlight: 'before' },
  },
  {
    id: 'stat-reveal',
    number: '03',
    name: 'Stat reveal',
    packId: 'bold',
    keyFrameS: 1,
    slotLabels: [
      ['Number', ''],
      ['Label', '6 words'],
      ['Source', '6 words'],
    ],
    beats: [
      { at: 0, line: 'Whip pan in with motion blur, Snappy' },
      { at: 0.1, line: 'The number counts up from 0 in place, 0.9 s' },
      { at: 0.6, line: 'Yellow bar line-draws to the value' },
      { at: null, line: 'Yellow block wipes up on a whip pan' },
    ],
    plan: [
      { id: 'number', slot: true, kind: 'text', depth: 'front', at: 0, move: 'whip', curve: SNAPPY },
      { id: 'count', kind: 'chart', depth: 'front', at: 0.1, move: 'count', ms: 900, count: { from: 0 }, onto: 'number' },
      { id: 'bar', kind: 'shape', depth: 'middle', at: 0.6, move: 'draw' },
      { id: 'label', slot: true, kind: 'text', depth: 'front', at: 0.7, move: 'rise' },
      { id: 'source', slot: true, kind: 'text', depth: 'front', at: 0.9, move: 'fade' },
    ],
    camera: { move: 'pan', amount: 0.5 },
    transition: 'whip-pan',
    sample: { number: '2,400', label: 'Cups poured before 9 am', source: 'Morning shift, October 2026 orders' },
  },
  {
    id: 'chart',
    number: '04',
    name: 'Chart',
    packId: 'corporate',
    keyFrameS: 0.9,
    slotLabels: [
      ['Title', '6 words'],
      ['2–6 Bars', 'label 2 words'],
      ['Note', '8 words'],
    ],
    beats: [
      { at: 0, line: 'Axis line-draws, Steady curve' },
      { at: 0.3, line: 'Bars grow from the data, 90 ms stagger' },
      { at: 0.4, line: 'Values count up, trend line draws on top' },
      { at: null, line: 'Rack focus to the note, then Hold' },
    ],
    plan: [
      { id: 'title', slot: true, kind: 'text', depth: 'front', at: 0, move: 'rise' },
      { id: 'axis', kind: 'path', depth: 'middle', at: 0, move: 'draw', curve: STEADY },
      { id: 'bars', slot: true, kind: 'chart', depth: 'middle', at: 0.3, move: 'grow' },
      { id: 'trend', kind: 'path', depth: 'front', at: 0.4, move: 'draw' },
      { id: 'note', slot: true, kind: 'text', depth: 'front', at: 1.2, move: 'fade' },
    ],
    camera: { move: 'rack-focus', amount: 0, focus: 'note' },
    transition: 'crossfade',
    depthBlur: 'soft',
    sample: {
      title: 'Time saved per week',
      bars: [
        { label: 'Week 1', value: 1.5 },
        { label: 'Week 2', value: 2.8 },
        { label: 'Week 3', value: 3.6 },
        { label: 'Week 4', value: 3.4 },
      ],
      note: 'Average across 1,200 beta users, September 2026',
    },
  },
  {
    id: 'quote',
    number: '05',
    name: 'Quote',
    packId: 'soft',
    keyFrameS: 1.2,
    slotLabels: [
      ['Quote', '24 words'],
      ['Name', '3 words'],
      ['Role', '4 words'],
    ],
    beats: [
      { at: 0, line: 'Glow blob morphs, particles drift at Back' },
      { at: 0.3, line: 'Quote per line, Floaty, softness 0 to 100' },
      { at: 1.4, line: 'Rack focus from the glow to the name' },
      { at: null, line: 'Blob morphs into the next scene’s shape' },
    ],
    plan: [
      { id: 'blob', kind: 'shape', depth: 'back', at: 0, move: 'morph', carry: 'blob', decor: 'blob' },
      { id: 'drift', kind: 'particles', depth: 'back', at: 0, move: 'fade', particles: DRIFT },
      { id: 'quote', slot: true, kind: 'text', depth: 'front', at: 0.3, move: 'rise', unit: 'line', curve: FLOATY, soft: [0, 100] },
      { id: 'name', slot: true, kind: 'text', depth: 'front', at: 1.4, move: 'fade' },
      { id: 'role', slot: true, kind: 'text', depth: 'front', at: 1.6, move: 'fade' },
    ],
    camera: { move: 'rack-focus', amount: 0, focus: 'name' },
    transition: 'match-cut',
    effects: [{ effect: 'glow', amount: 0.45, colour: 'glow', scope: 'layer', layerId: 'blob' }],
    depthBlur: 'soft',
    sample: {
      quote: 'The oat flat white is the reason I leave the house ten minutes early.',
      name: 'Ada Okafor',
      role: 'Night shift nurse',
    },
  },
  {
    id: 'list',
    number: '06',
    name: 'List',
    packId: 'clean',
    keyFrameS: 0.6,
    slotLabels: [
      ['Title', '5 words'],
      ['3–5 Items', '5 words each'],
    ],
    beats: [
      { at: 0, line: 'Title shape reveal, Spring · 10% bounce' },
      { at: 0.25, line: 'Cards rise per item, 80 ms overlap' },
      { at: 0.4, line: 'Checks line-draw, depth shadows grow' },
      { at: null, line: 'Slow Push in 3%, last card carries on' },
    ],
    plan: [
      { id: 'title', slot: true, kind: 'text', depth: 'front', at: 0, move: 'wipe', curve: spring(10) },
      { id: 'items', slot: true, kind: 'text', depth: 'front', at: 0.25, move: 'rise', unit: 'line', carry: 'card' },
      { id: 'checks', kind: 'path', depth: 'front', at: 0.4, move: 'draw' },
    ],
    camera: { move: 'push-in', amount: 0.03 },
    transition: 'carry',
    depthShadows: true,
    sample: {
      title: 'What’s new in Fieldnote',
      items: [
        'Search across every notebook',
        'Offline sync that just works',
        'Shared spaces for your team',
        'Voice notes, transcribed on device',
      ],
    },
  },
  {
    id: 'hero',
    number: '07',
    name: 'Hero',
    packId: 'gloss',
    keyFrameS: 0.8,
    slotLabels: [
      ['Headline', '6 words'],
      ['Line', '10 words'],
    ],
    beats: [
      { at: 0, line: 'Pills drop in, Spring · 35% bounce' },
      { at: 0.2, line: 'Headline per word, extruded 3D, depth 10' },
      { at: 0.5, line: 'Orbit 8° round the arch, layers parallax' },
      { at: null, line: 'Pink arch masks into the next scene' },
    ],
    plan: [
      { id: 'media', slot: true, kind: 'media', depth: 'back', at: 0, move: 'fade' },
      { id: 'arch', kind: 'shape', depth: 'back', at: 0, move: 'wipe', z: -2, carry: 'arch', decor: 'arch' },
      { id: 'pills', kind: 'model', depth: 'middle', at: 0, move: 'drop', curve: spring(35) },
      { id: 'headline', slot: true, kind: 'text', depth: 'front', at: 0.2, move: 'extrude', unit: 'word', extrude: [10, 10] },
      { id: 'line', slot: true, kind: 'text', depth: 'front', at: 0.5, move: 'rise' },
    ],
    camera: { move: 'orbit', amount: 8 / 30 },
    transition: 'shape-reveal',
    sample: { headline: 'Coffee that comes to you.', line: 'Pier Street cart, weekdays from 6 am.' },
  },
  {
    id: 'split',
    number: '08',
    name: 'Split',
    packId: 'studio',
    keyFrameS: 0.9,
    slotLabels: [
      ['Headline', '6 words'],
      ['Body', '16 words'],
    ],
    beats: [
      { at: 0, line: 'Glass rises Back to Middle, blur 12 to 0' },
      { at: 0.25, line: 'Headline per word, 40 ms overlap' },
      { at: 0.6, line: 'Light sweeps the found word, glow' },
      { at: null, line: 'Pan 6% down, the panel carries on' },
    ],
    plan: [
      { id: 'media', slot: true, kind: 'media', depth: 'middle', at: 0, move: 'focus-in', carry: 'panel' },
      { id: 'headline', slot: true, kind: 'text', depth: 'front', at: 0.25, move: 'rise', unit: 'word' },
      { id: 'body', slot: true, kind: 'text', depth: 'front', at: 0.5, move: 'fade', unit: 'line' },
    ],
    camera: { move: 'pan', amount: 0.06 },
    transition: 'carry',
    effects: [
      { effect: 'light-sweep', amount: 0.5, colour: 'light', scope: 'layer', layerId: 'media' },
      { effect: 'glow', amount: 0.6, colour: 'glow', scope: 'layer', layerId: 'media' },
    ],
    sample: {
      headline: 'Search that reads your handwriting.',
      body: 'Snap a page, then find any word in it seconds later. Everything stays on your device.',
    },
  },
  {
    id: 'before-after',
    number: '09',
    name: 'Before and after',
    packId: 'kinetic',
    keyFrameS: 0.9,
    slotLabels: [['Labels', '3 words each']],
    beats: [
      { at: 0, line: 'Notes scatter in on the beat, Snappy' },
      { at: 0.6, line: 'Diagonal mask wipes to After, 0.5 s' },
      { at: 0.8, line: 'Rows snap into place, 40 ms stagger' },
      { at: null, line: 'Label width 100 to 75, then Hold' },
    ],
    plan: [
      { id: 'beforeMedia', slot: true, kind: 'media', depth: 'middle', at: 0, move: 'scatter', curve: SNAPPY },
      { id: 'before', slot: true, kind: 'text', depth: 'front', at: 0, move: 'fill', unit: 'word' },
      { id: 'afterMedia', slot: true, kind: 'media', depth: 'middle', at: 0.6, move: 'wipe', ms: 500 },
      { id: 'after', slot: true, kind: 'text', depth: 'front', at: 0.8, move: 'rise', unit: 'word', curve: SNAPPY },
    ],
    camera: { move: 'hold', amount: 0 },
    transition: 'cut',
    sample: { before: 'Scattered notes', after: 'One calm inbox' },
  },
  {
    id: 'steps',
    number: '10',
    name: 'Steps',
    packId: 'playful',
    keyFrameS: 0.9,
    slotLabels: [
      ['Title', '5 words'],
      ['3 Steps', '4 words each'],
    ],
    beats: [
      { at: 0, line: 'Title bounces in, Spring · 45% bounce' },
      { at: 0.3, line: 'Cards drop with physics, squash and stretch' },
      { at: 0.5, line: 'Path line-draws step to step, 0.8 s' },
      { at: null, line: 'Last blob morphs into the next scene' },
    ],
    plan: [
      { id: 'title', slot: true, kind: 'text', depth: 'front', at: 0, move: 'rise', curve: spring(45) },
      { id: 'steps', slot: true, kind: 'text', depth: 'front', at: 0.3, move: 'drop', unit: 'line' },
      { id: 'path', kind: 'path', depth: 'middle', at: 0.5, move: 'draw', ms: 800, decor: 'line' },
      { id: 'blob', kind: 'shape', depth: 'back', at: 0.5, move: 'morph', carry: 'blob', decor: 'blob' },
    ],
    camera: { move: 'hold', amount: 0 },
    transition: 'match-cut',
    sample: {
      title: 'Order ahead in three taps',
      steps: ['Pick your drink', 'Choose a pickup time', 'Grab it, still hot'],
    },
  },
  {
    id: 'logo-sting',
    number: '11',
    name: 'Logo sting',
    packId: 'gloss',
    keyFrameS: 0.8,
    slotLabels: [['Tagline', '5 words']],
    beats: [
      { at: 0, line: 'Spheres orbit in, Spring · 30% bounce' },
      { at: 0.3, line: 'Wordmark extrudes in 3D, depth 0 to 18' },
      { at: 0.7, line: 'Orbit 12°, then Hold, light sweeps the bevel' },
      { at: 1.1, line: 'Tagline per word, 50 ms overlap' },
    ],
    plan: [
      { id: 'spheres', kind: 'model', depth: 'middle', at: 0, move: 'orbit-in', curve: spring(30) },
      { id: 'logo', slot: true, kind: 'media', depth: 'front', at: 0.3, move: 'extrude', extrude: [0, 18] },
      { id: 'tagline', slot: true, kind: 'text', depth: 'front', at: 1.1, move: 'rise', unit: 'word' },
    ],
    camera: { move: 'orbit', amount: 12 / 30 },
    transition: 'cut',
    effects: [{ effect: 'light-sweep', amount: 0.5, colour: 'light', scope: 'layer', layerId: 'logo' }],
    sample: { tagline: 'Think it. Find it.' },
  },
  {
    id: 'end-card',
    number: '12',
    name: 'End card',
    packId: 'soft',
    keyFrameS: 0.8,
    slotLabels: [
      ['Call to action', '5 words'],
      ['Link', '4 words'],
    ],
    beats: [
      { at: 0, line: 'Last scene’s shape morphs into the button' },
      { at: 0.3, line: 'Call to action per word, Floaty' },
      { at: 0.7, line: 'Link underline line-draws, 0.6 s' },
      { at: null, line: 'Particles drift, Pull out 3%, then Hold' },
    ],
    plan: [
      { id: 'button', kind: 'shape', depth: 'middle', at: 0, move: 'morph', carry: 'blob', backs: ['cta'] },
      { id: 'cta', slot: true, kind: 'text', depth: 'front', at: 0.3, move: 'rise', unit: 'word', curve: FLOATY },
      { id: 'handle', slot: true, kind: 'text', depth: 'front', at: 0.6, move: 'fade' },
      { id: 'underline', kind: 'path', depth: 'front', at: 0.7, move: 'draw', ms: 600 },
      { id: 'logo', slot: true, kind: 'media', depth: 'front', at: 0.9, move: 'fade' },
      { id: 'drift', kind: 'particles', depth: 'back', at: 0, move: 'drift', particles: DRIFT },
    ],
    camera: { move: 'pull-out', amount: 0.03 },
    transition: 'cut',
    sample: { cta: 'Try Fieldnote free today', handle: 'fieldnote.app/try' },
  },
];

export const getTemplateV3 = (id: string): TemplateV3 | undefined => TEMPLATES_V3.find((t) => t.id === id);
