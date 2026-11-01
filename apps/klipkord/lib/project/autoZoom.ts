import { rampMs } from '../render/spring';
import type { Feel, RecEvent, Zoom } from './types';

/** Clicks and typing further apart than this start a new zoom. */
export const GROUP_GAP_MS = 1500;
/** A zoom never covers actions spread wider or taller than this share of the viewport. */
export const GROUP_SPAN = 0.4;
/** Room kept around the actions, each side, as a share of the viewport. */
export const MARGIN = 0.15;
export const MIN_DEPTH = 1.25;
export const MAX_DEPTH = 2;
/** Typing keeps more of the page around the field in view. */
export const TYPING_DEPTH = 1.5;
/** A zoom stays in this long after the last action, then eases out. */
export const HOLD_MS = 1200;

interface Action { t: number; x: number; y: number; typing: boolean }
interface Group { actions: Action[]; x0: number; y0: number; x1: number; y1: number; page: number }  // page: count of scrolls and page loads before it

const fits = (g: Group, x0: number, y0: number, x1: number, y1: number) =>
  Math.max(g.x1, x1) - Math.min(g.x0, x0) <= GROUP_SPAN && Math.max(g.y1, y1) - Math.min(g.y0, y0) <= GROUP_SPAN;
const grow = (g: Group, o: Group): Group => ({
  page: g.page,
  actions: [...g.actions, ...o.actions],
  x0: Math.min(g.x0, o.x0), y0: Math.min(g.y0, o.y0), x1: Math.max(g.x1, o.x1), y1: Math.max(g.y1, o.y1),
});
const single = (a: Action, page: number): Group => ({ actions: [a], x0: a.x, y0: a.y, x1: a.x, y1: a.y, page });
const first = (g: Group) => g.actions[0]!.t;
const last = (g: Group) => g.actions[g.actions.length - 1]!.t;
const typing = (g: Group) => g.actions.some((a) => a.typing);

/** Clicks and typing with a place on the page; a scroll or a new page ends what came before. */
function actions(events: RecEvent[]): (Action | 'break')[] {
  const out: (Action | 'break')[] = [];
  let at: { x: number; y: number } | null = null;
  for (const e of events) {
    if (e.type === 'move') at = e;
    else if (e.type === 'click') {
      at = e;
      out.push({ t: e.t, x: e.x, y: e.y, typing: false });
    } else if (e.type === 'key') {
      const spot = e.x !== undefined && e.y !== undefined ? { x: e.x, y: e.y } : at;
      if (e.key === 'typing' && spot) out.push({ t: e.t, x: spot.x, y: spot.y, typing: true });
    } else out.push('break');
  }
  return out;
}

/** Deepest zoom that keeps all the actions in view with a margin, within MIN_DEPTH..MAX_DEPTH. */
export function depthFor(g: Pick<Group, 'x0' | 'y0' | 'x1' | 'y1'>, isTyping: boolean): number {
  const need = Math.max(g.x1 - g.x0, g.y1 - g.y0) + 2 * MARGIN;
  const depth = Math.min(isTyping ? TYPING_DEPTH : MAX_DEPTH, 1 / need);
  return Math.max(MIN_DEPTH, Math.round(depth * 10) / 10);
}

/** What made the zoom, shown in ZoomEdit's list: "Click", "3 clicks" or "Typing". */
export function whyFor(g: Pick<Group, 'actions'>): string {
  if (g.actions.some((a) => a.typing)) return 'Typing';
  const n = g.actions.length;
  return n === 1 ? 'Click' : `${n} clicks`;
}

const reach = (g: Group, feel: Feel) => rampMs(depthFor(g, typing(g)), feel);

/**
 * Zoom blocks from an events track: clicks and typing close in time and place become one zoom that is fully in
 * at the first action and eases out after the last. Blocks never overlap. `duration`: the recording's length.
 */
export function autoZoom(events: RecEvent[], feel: Feel = 'smooth', duration = Infinity): Zoom[] {
  const groups: Group[] = [];
  let open: Group | null = null;
  let page = 0;
  for (const a of actions(events)) {
    if (a === 'break') {
      open = null;
      page++;
      continue;
    }
    if (open && a.t - last(open) <= GROUP_GAP_MS && fits(open, a.x, a.y, a.x, a.y)) {
      groups[groups.length - 1] = open = grow(open, single(a, page));
    } else groups.push((open = single(a, page)));
  }
  // Neighbours whose zooms would run into each other become one, when the place still fits.
  const merged: Group[] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && prev.page === g.page && first(g) - last(prev) < HOLD_MS + reach(prev, feel) + reach(g, feel) && fits(prev, g.x0, g.y0, g.x1, g.y1)) {
      merged[merged.length - 1] = grow(prev, g);
    } else merged.push(g);
  }
  const zooms: Zoom[] = merged.map((g) => {
    const depth = depthFor(g, typing(g));
    const ramp = rampMs(depth, feel);
    return {
      id: `auto-${Math.round(first(g))}`,
      at: Math.max(0, first(g) - ramp),
      end: Math.min(duration, last(g) + HOLD_MS + ramp),
      depth,
      focus: { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 },
      feel,
      auto: true,
      why: whyFor(g),
    };
  });
  // Zooms on different places that still meet hand over halfway between their actions.
  for (let i = 1; i < zooms.length; i++) {
    const a = zooms[i - 1]!;
    const b = zooms[i]!;
    if (b.at < a.end) {
      const mid = (last(merged[i - 1]!) + first(merged[i]!)) / 2;
      a.end = mid;
      b.at = mid;
    }
  }
  return zooms.filter((z) => z.end > z.at);
}
