import type { Look } from '../../project/types';

/** A gradient stop: colour and position 0..1 along a 135° line. */
export type Stop = readonly [string, number];

/** The background gradients (FRAMES.md "Look tab and zoom values"), in swatch order; Ember is the default. */
export const GRADIENTS: Readonly<Record<string, readonly Stop[]>> = {
  ember: [['#7C2D12', 0], ['#C2410C', 0.5], ['#FDBA74', 1]],
  ocean: [['#1E3A8A', 0], ['#60A5FA', 1]],
  forest: [['#14532D', 0], ['#4ADE80', 1]],
  graphite: [['#111114', 0], ['#3F3F46', 1]],
  stone: [['#F5F5F4', 0], ['#D6D3D1', 1]],
  dusk: [['#581C87', 0], ['#F472B6', 1]],
};
/** Drawn when a background cannot be: an unknown gradient, a missing image or no screen to blur. */
export const FALLBACK_COLOUR = '#1C1917';

export type BackgroundFill =
  | { kind: 'colour'; colour: string }
  | { kind: 'gradient'; stops: readonly Stop[] }
  | { kind: 'picture'; blur: boolean };

/** What the background layer fills with. `picture`: a background image or the screen frame was found. */
export function backgroundFill(bg: Look['background'], picture: boolean): BackgroundFill {
  if (bg.kind === 'colour') return { kind: 'colour', colour: bg.value || FALLBACK_COLOUR };
  if (bg.kind === 'gradient') {
    const stops = GRADIENTS[bg.value];
    return stops ? { kind: 'gradient', stops } : { kind: 'colour', colour: FALLBACK_COLOUR };
  }
  return picture ? { kind: 'picture', blur: bg.kind === 'blurred' } : { kind: 'colour', colour: FALLBACK_COLOUR };
}

const parsed = new Map<string, readonly [number, number, number, number]>();

/** A CSS hex or rgb()/rgba() colour → premultiplied-ready [r, g, b, a] in 0..1. Unknown colours are opaque black. */
export function rgba(css: string): readonly [number, number, number, number] {
  const hit = parsed.get(css);
  if (hit) return hit;
  let out: [number, number, number, number] = [0, 0, 0, 1];
  const hex = /^#([0-9a-f]{3,8})$/i.exec(css.trim());
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    if (h.length === 6 || h.length === 8) out = [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  } else {
    const fn = /^rgba?\(([^)]+)\)$/i.exec(css.trim());
    const parts = fn?.[1]!.split(',').map((p) => parseFloat(p));
    if (parts && parts.length >= 3 && parts.every(Number.isFinite)) {
      out = [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255, parts[3] ?? 1];
    }
  }
  parsed.set(css, out);
  return out;
}
