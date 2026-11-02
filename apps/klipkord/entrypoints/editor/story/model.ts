import { addLayer, newId, updateLayer } from '@/lib/project/ops';
import { toOut, toRec } from '@/lib/project/time';
import type { Box, Card, Cut, Overlay, Project } from '@/lib/project/types';
import { capWords, cardDefaultMs, cardSlots, type CardTemplate } from '@/lib/render/layers/card';

/** A new overlay shows this long from the playhead. */
export const OVERLAY_MS = 3000;
/** The smallest box side, as a share of the screen picture, so a handle never collapses it. */
export const MIN_SIDE = 0.02;

/** Where each kind first lands on the screen picture (0..1); the arrow keeps the frame's 60 × 44 shape. */
const START_BOX: Record<Overlay['kind'], Box> = {
  text: { x: 0.3, y: 0.4, w: 0.4, h: 0.12 },
  arrow: { x: 0.46, y: 0.42, w: 0.08, h: 0.104 },
  callout: { x: 0.35, y: 0.42, w: 0.3, h: 0.09 },
  highlight: { x: 0.3, y: 0.3, w: 0.4, h: 0.25 },
  spotlight: { x: 0.3, y: 0.3, w: 0.4, h: 0.25 },
  blur: { x: 0.35, y: 0.3, w: 0.3, h: 0.08 },
};

/** Default blur strength: the Overlays frame's slider at 60% reads "Strong". */
/** Blur Amount's three stops; Strong is the default. */
export const BLUR_STOPS = [{ value: 'light', label: 'Light', amount: 0.3 }, { value: 'medium', label: 'Medium', amount: 0.6 }, { value: 'strong', label: 'Strong', amount: 0.9 }] as const;
export const BLUR_AMOUNT = 0.9;
export const blurStop = (amount: number) => BLUR_STOPS.reduce((a, b) => (Math.abs(b.amount - amount) < Math.abs(a.amount - amount) ? b : a));

/** OVERLAY_MS from the playhead (output ms), in recording time, ending by the recording's end. */
export function spanAt(cut: Cut, out: number, duration: number): { at: number; end: number } {
  const at = Math.max(0, Math.round(toRec(cut, out) ?? 0));
  return { at, end: Math.max(at + 1, Math.min(at + OVERLAY_MS, duration > at ? duration : at + OVERLAY_MS)) };
}

/** A new overlay at the playhead (output ms), anchored to recording time. */
export function newOverlay(cut: Cut, kind: Overlay['kind'], out: number, duration: number): Overlay {
  return {
    id: newId(), kind, ...spanAt(cut, out, duration), box: { ...START_BOX[kind] }, motion: 'fade',
    ...((kind === 'text' || kind === 'callout') && { text: '' }),
    ...(kind === 'blur' && { blur: { mode: 'blur' as const, amount: BLUR_AMOUNT, follow: false } }),
  };
}

/** Adds one overlay as one Undo step ("Added a blur"). */
export const addOverlay = (project: Project, overlay: Overlay): Project => addLayer(project, { kind: 'overlays', items: [overlay] });

/** One change to an overlay as one Undo step ("Changed the blur at 0:14"). */
export const changeOverlay = (project: Project, id: string, patch: Partial<Omit<Overlay, 'id'>>): Project =>
  updateLayer(project, { kind: 'overlays', id, patch });

/** The overlay's span in output time where it is kept, else its recording time. */
export function shownSpan(cut: Cut, o: Overlay): [number, number] {
  return [toOut(cut, o.at) ?? o.at, toOut(cut, o.end) ?? o.end];
}

/** "Keep for the whole video": from the start of the recording to its end. */
export const wholeVideo = (o: Overlay, duration: number): boolean => o.at <= 0 && o.end >= duration;

/** Moves a box by (dx, dy) or drags one corner, in screen-picture units, keeping it at least MIN_SIDE wide and tall. */
export function dragBox(b: Box, handle: 'move' | 'nw' | 'ne' | 'sw' | 'se', dx: number, dy: number): Box {
  if (handle === 'move') return { ...b, x: b.x + dx, y: b.y + dy };
  let { x, y, w, h } = b;
  if (handle === 'nw' || handle === 'sw') {
    const nx = Math.min(x + dx, x + w - MIN_SIDE);
    w += x - nx;
    x = nx;
  } else w = Math.max(MIN_SIDE, w + dx);
  if (handle === 'nw' || handle === 'ne') {
    const ny = Math.min(y + dy, y + h - MIN_SIDE);
    h += y - ny;
    y = ny;
  } else h = Math.max(MIN_SIDE, h + dy);
  return { x, y, w, h };
}

/** Frame-pixel deltas into screen-picture units, through the crop the preview shows. */
export const toPicture = (dxFrame: number, dyFrame: number, crop: Box, dest: Box): { dx: number; dy: number } => ({
  dx: dest.w > 0 ? (dxFrame / dest.w) * crop.w : 0,
  dy: dest.h > 0 ? (dyFrame / dest.h) * crop.h : 0,
});

/** The Cards frame's logo sting runs 1.5 s; the others keep their template's length. */
export const LOGO_STING_MS = 1500;

/**
 * A new card in output time: a title hook at the start, an end card at the finish, a logo sting at the playhead.
 * It overlays the picture for `ms`, anchored to recording time; a title hook starts with the recording's title.
 */
export function newCard(cut: Cut, template: CardTemplate, out: number, length: number, title: string): Card {
  const ms = template === 'logo-sting' ? LOGO_STING_MS : cardDefaultMs(template);
  const start = template === 'title-hook' ? 0 : template === 'end-card' ? Math.max(0, length - ms) : out;
  const headline = cardSlots(template).find((s) => s.id === 'headline');
  return {
    id: newId(), template, at: Math.max(0, Math.round(toRec(cut, start) ?? 0)), ms, pack: 'clean',
    slots: headline && title.trim() ? { headline: capWords(title.trim(), headline.words) } : {},
  };
}

/** Adds one card as one Undo step ("Added a title hook"). */
export const addCard = (project: Project, card: Card): Project => addLayer(project, { kind: 'cards', items: [card] });

/** One change to a card as one Undo step ("Changed the title hook at 00:00"). */
export const changeCard = (project: Project, id: string, patch: Partial<Omit<Card, 'id'>>): Project =>
  updateLayer(project, { kind: 'cards', id, patch });
