// The 8 v3 style packs, copied from the PacksV3 frame. A pack sets fonts, colours, motion feel, camera habit,
// transitions and finishing; the template keeps the layout and word limits.
import type { CameraMove, Curve, Feel, Finish, LookGuide } from '@appskord/motion/types';

export type PackId = 'clean' | 'bold' | 'playful' | 'corporate' | 'studio' | 'kinetic' | 'gloss' | 'soft';
/** Transition ids, named as in TransitionsV3. */
export type TransitionId =
  | 'carry'
  | 'shape-reveal'
  | 'mask-wipe'
  | 'match-cut'
  | 'light-sweep'
  | 'whip-pan'
  | 'cut'
  | 'crossfade'
  | 'slide'
  | 'push';
export const TRANSITION_LABELS: Readonly<Record<TransitionId, string>> = {
  carry: 'Carry over',
  'shape-reveal': 'Shape reveal',
  'mask-wipe': 'Mask wipe',
  'match-cut': 'Match cut',
  'light-sweep': 'Light sweep',
  'whip-pan': 'Whip pan',
  cut: 'Cut',
  crossfade: 'Cross-fade',
  slide: 'Slide',
  push: 'Push',
};
export type Level = 'Off' | 'Low' | 'Medium' | 'High' | 'Max';
export const LEVEL_AMOUNT: Readonly<Record<Level, number>> = { Off: 0, Low: 0.25, Medium: 0.5, High: 0.75, Max: 1 };

export interface PackFont {
  family: string;
  /** The line under "Aa": "Headings 700", "Width axis 62–125". */
  label: string;
  weight: number;
}
export interface PackV3 {
  id: PackId;
  name: string;
  badge: 'Redrawn' | 'New';
  description: string;
  fonts: { display: PackFont; text: PackFont };
  colours: string[];
  feel: Feel;
  /** "Ease out · 600 ms", "Spring · 50% bounce". */
  feelLabel: string;
  curve: Curve;
  camera: { label: string; move: CameraMove; amount: number };
  transitions: TransitionId[];
  finishing: { grain: Level; glow: Level; blur: Level };
  /** The two sample cards: "Title hook · 9:16" and one more. */
  samples: [string, string];
  light: LookGuide['light'];
}

const ease = (p: [number, number, number, number]): Curve => ({ kind: 'bezier', p });
const EASE_OUT = ease([0.22, 1, 0.36, 1]);
const FAST_OUT = ease([0.2, 0, 0, 1]);
const IN_OUT = ease([0.45, 0, 0.55, 1]);
const FLOAT_OUT = ease([0.5, 0, 0.1, 1]);
const spring = (bounce: number, ms = 700): Curve => ({ kind: 'spring', bounce, ms });

/** Frame order: the four redrawn packs, then the four new ones. */
export const PACKS_V3: readonly PackV3[] = [
  {
    id: 'clean',
    name: 'Clean',
    badge: 'Redrawn',
    description:
      'Inter on white fading to slate. Shapes reveal each scene; soft shadows give depth and the camera pushes in slowly.',
    fonts: {
      display: { family: 'Inter', label: 'Headings 700', weight: 700 },
      text: { family: 'Inter', label: 'Body 400', weight: 400 },
    },
    colours: ['#FFFFFF', '#F1F5F9', '#0F172A', '#2563EB'],
    feel: 'smooth',
    feelLabel: 'Ease out · 600 ms',
    curve: EASE_OUT,
    camera: { label: 'Push in, slow', move: 'push-in', amount: 0.03 },
    transitions: ['shape-reveal', 'carry', 'crossfade'],
    finishing: { grain: 'Low', glow: 'Low', blur: 'Medium' },
    samples: ['Title hook · 9:16', 'Stat reveal · 1:1'],
    light: 'top',
  },
  {
    id: 'bold',
    name: 'Bold',
    badge: 'Redrawn',
    description: 'Archivo Black on black, stretched to fill the frame. Type snaps in; whip pans blur between scenes.',
    fonts: {
      display: { family: 'Archivo Black', label: 'Headings', weight: 400 },
      text: { family: 'Archivo', label: 'Width axis 62–125', weight: 600 },
    },
    colours: ['#0A0A0A', '#FFFFFF', '#FACC15'],
    feel: 'snappy',
    feelLabel: 'Fast out · 320 ms',
    curve: FAST_OUT,
    camera: { label: 'Pan, whip fast', move: 'pan', amount: 0.5 },
    transitions: ['cut', 'mask-wipe', 'match-cut'],
    finishing: { grain: 'Low', glow: 'Off', blur: 'Max' },
    samples: ['Title hook · 9:16', 'Big statement · 1:1'],
    light: 'none',
  },
  {
    id: 'playful',
    name: 'Playful',
    badge: 'Redrawn',
    description: 'Fredoka on warm cream. Words drop in and squash as they land; blobs morph between scenes.',
    fonts: {
      display: { family: 'Fredoka', label: 'Headings 600', weight: 600 },
      text: { family: 'Nunito', label: 'Body 400', weight: 400 },
    },
    colours: ['#FFF7ED', '#1C1917', '#F97316', '#14B8A6'],
    feel: 'bouncy',
    feelLabel: 'Spring · 50% bounce',
    curve: spring(50),
    camera: { label: 'Hold, physics drops', move: 'hold', amount: 0 },
    transitions: ['shape-reveal', 'carry', 'match-cut'],
    finishing: { grain: 'Low', glow: 'Low', blur: 'Medium' },
    samples: ['Title hook · 9:16', 'Steps · 1:1'],
    light: 'top',
  },
  {
    id: 'corporate',
    name: 'Corporate',
    badge: 'Redrawn',
    description:
      'Source Serif 4 on fine-grain navy. Charts draw themselves line by line; focus racks from back to front.',
    fonts: {
      display: { family: 'Source Serif 4', label: 'Headings 600', weight: 600 },
      text: { family: 'IBM Plex Sans', label: 'Body 400', weight: 400 },
    },
    colours: ['#0F2A4A', '#FFFFFF', '#38BDF8'],
    feel: 'steady',
    feelLabel: 'In and out · 500 ms',
    curve: IN_OUT,
    camera: { label: 'Rack focus', move: 'rack-focus', amount: 0 },
    transitions: ['crossfade', 'mask-wipe', 'carry'],
    finishing: { grain: 'High', glow: 'Off', blur: 'Medium' },
    samples: ['Title hook · 9:16', 'Chart · 1:1'],
    light: 'left',
  },
  {
    id: 'studio',
    name: 'Studio',
    badge: 'New',
    description:
      'Geist on near-black with a soft glow. Glass panels drift in; the camera pushes slowly and light sweeps between scenes.',
    fonts: {
      display: { family: 'Geist', label: 'Headings 600', weight: 600 },
      text: { family: 'Geist Mono', label: 'Kickers, numbers', weight: 400 },
    },
    colours: ['#0B0B10', '#F5F5F7', '#8B9CFF'],
    feel: 'smooth',
    feelLabel: 'Ease out · 600 ms',
    curve: EASE_OUT,
    camera: { label: 'Push in, slow', move: 'push-in', amount: 0.03 },
    transitions: ['crossfade', 'carry', 'shape-reveal'],
    finishing: { grain: 'Medium', glow: 'Max', blur: 'Medium' },
    samples: ['Title hook · 9:16', 'Hero · 1:1'],
    light: 'top',
  },
  {
    id: 'kinetic',
    name: 'Kinetic',
    badge: 'New',
    description:
      'Bricolage Grotesque, huge, on flat green and stone. Letters stretch and widen; masks reveal and every cut lands on the beat.',
    fonts: {
      display: { family: 'Bricolage Grotesque', label: 'Display 800', weight: 800 },
      text: { family: 'Bricolage Grotesque', label: 'Width axis 75–100', weight: 500 },
    },
    colours: ['#1F7A4D', '#E6E4DD', '#111111', '#FF5FA2', '#FFD23F', '#3D5AFE'],
    feel: 'snappy',
    feelLabel: 'Fast out · 320 ms',
    curve: FAST_OUT,
    camera: { label: 'Hold, cuts on the beat', move: 'hold', amount: 0 },
    transitions: ['cut', 'mask-wipe', 'match-cut'],
    finishing: { grain: 'Medium', glow: 'Off', blur: 'High' },
    samples: ['Title hook · 9:16', 'Quote · 1:1'],
    light: 'none',
  },
  {
    id: 'gloss',
    name: 'Gloss',
    badge: 'New',
    description:
      'Outfit on bright blue with glossy 3D pills and arches. Everything springs into place while the camera orbits.',
    fonts: {
      display: { family: 'Outfit', label: 'Headings 800, 3D', weight: 800 },
      text: { family: 'Outfit', label: 'Body 400', weight: 400 },
    },
    colours: ['#2F6BFF', '#FFFFFF', '#FF3D8B', '#FFD60A', '#22D3EE'],
    feel: 'bouncy',
    feelLabel: 'Spring · 35% bounce',
    curve: spring(35),
    camera: { label: 'Orbit', move: 'orbit', amount: 8 / 30 },
    transitions: ['carry', 'shape-reveal', 'match-cut'],
    finishing: { grain: 'Off', glow: 'High', blur: 'Medium' },
    samples: ['Title hook · 9:16', 'Logo sting · 1:1'],
    light: 'top',
  },
  {
    id: 'soft',
    name: 'Soft',
    badge: 'New',
    description:
      'Fraunces on warm sand with a low glow. Shapes melt into each other, particles drift and focus shifts slowly.',
    fonts: {
      display: { family: 'Fraunces', label: 'Headings, variable', weight: 600 },
      text: { family: 'Inter', label: 'Body 400', weight: 400 },
    },
    colours: ['#EFE6DA', '#2B2620', '#E4572E'],
    feel: 'floaty',
    feelLabel: 'Ease out · 1,200 ms',
    curve: FLOAT_OUT,
    camera: { label: 'Rack focus, slow', move: 'rack-focus', amount: 0 },
    transitions: ['crossfade', 'carry', 'shape-reveal'],
    finishing: { grain: 'High', glow: 'High', blur: 'High' },
    samples: ['Title hook · 9:16', 'End card · 1:1'],
    light: 'left',
  },
];

export const PACK_IDS: readonly PackId[] = PACKS_V3.map((p) => p.id);
export const isPackId = (id: unknown): id is PackId => PACK_IDS.includes(id as PackId);
export function getPackV3(id: string): PackV3 {
  return PACKS_V3.find((p) => p.id === id) ?? PACKS_V3[0]!;
}

/** The pack's finishing amounts as the recipe's Finish; Glow drives the soft light, the grade stays gentle. */
export function packFinish(pack: PackV3): Finish {
  const { grain, glow, blur } = pack.finishing;
  return { on: true, blur: LEVEL_AMOUNT[blur], light: LEVEL_AMOUNT[glow], grain: LEVEL_AMOUNT[grain], grade: 0.5 };
}

/** The look guide a pack starts as ("From pack: Studio"). */
export function packLook(pack: PackV3): LookGuide {
  return {
    id: `pack-${pack.id}`,
    name: pack.name,
    palette: [...pack.colours],
    type: { display: pack.fonts.display.family, text: pack.fonts.text.family },
    feel: pack.feel,
    light: pack.light,
    texture: LEVEL_AMOUNT[pack.finishing.grain],
    camera: pack.camera.move,
  };
}

