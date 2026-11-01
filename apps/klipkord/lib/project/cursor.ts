import { ease, omega, springStep, type SpringState } from '../render/spring';
import type { RecEvent } from './types';

/** A click ring fades over this long. */
export const CLICK_MS = 500;
/** The smooth cursor settles on a new spot in this long. */
export const CURSOR_SETTLE_MS = 180;
/** The smooth cursor lands on a click's own spot over this long before it. */
export const CONVERGE_MS = 150;
// Older moves have decayed below a hundredth of a pixel by this many settle times.
const WINDOW_MS = CURSOR_SETTLE_MS * 1.6;

type Pointer = Extract<RecEvent, { type: 'move' | 'click' }>;
type Click = Extract<RecEvent, { type: 'click' }>;
const isPointer = (e: RecEvent): e is Pointer => e.type === 'move' || e.type === 'click';

/** Index of the last event at or before `t` (events sorted by t), or -1. */
export function lastAt(events: RecEvent[], t: number): number {
  let lo = 0;
  let hi = events.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.t <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

function pointerBefore(events: RecEvent[], from: number): number {
  let i = from;
  while (i >= 0 && !isPointer(events[i]!)) i--;
  return i;
}

/** The click whose ring shows at `rec`: the latest one less than CLICK_MS before it. */
function ringClick(events: RecEvent[], rec: number, last: number): Click | null {
  for (let j = last; j >= 0 && rec - events[j]!.t < CLICK_MS; j--) {
    const e = events[j]!;
    if (e.type === 'click') return e;
  }
  return null;
}

/** Click ring at `rec`: 1 at the click, fading to 0 over CLICK_MS. */
export function clickAt(events: RecEvent[], rec: number, last = lastAt(events, rec)): number {
  const c = ringClick(events, rec, last);
  return c ? 1 - (rec - c.t) / CLICK_MS : 0;
}

/** How hard a click holds the smooth cursor on its spot: eases on over CONVERGE_MS before it, off over CURSOR_SETTLE_MS after. */
function pull(events: RecEvent[], rec: number, last: number): { w: number; x: number; y: number } | null {
  let best: { w: number; x: number; y: number } | null = null;
  for (let j = last + 1; j < events.length && events[j]!.t - rec <= CONVERGE_MS; j++) {
    const e = events[j]!;
    if (e.type === 'click') {
      best = { w: ease(1 - (e.t - rec) / CONVERGE_MS), x: e.x, y: e.y };
      break;
    }
  }
  for (let j = last; j >= 0 && rec - events[j]!.t < CURSOR_SETTLE_MS; j--) {
    const e = events[j]!;
    if (e.type !== 'click') continue;
    const w = 1 - ease((rec - e.t) / CURSOR_SETTLE_MS);
    if (!best || w > best.w) best = { w, x: e.x, y: e.y };
    break;
  }
  return best;
}

/**
 * The steadied cursor at `rec`: a critically damped spring follows the recorded spots, so hand shake and the
 * 30-a-second sampling smooth out, and it can be read at any frame time.
 */
export function smoothAt(events: RecEvent[], rec: number, last = lastAt(events, rec)): { x: number; y: number } | null {
  const end = pointerBefore(events, last);
  if (end < 0) return null;
  // Start from the spot held when the window opens; what came before has decayed away.
  let i = end;
  while (i > 0 && events[i]!.t > rec - WINDOW_MS) {
    const prev = pointerBefore(events, i - 1);
    if (prev < 0) break;
    i = prev;
  }
  const first = events[i] as Pointer;
  const w = omega(CURSOR_SETTLE_MS);
  let t = Math.max(first.t, rec - WINDOW_MS);
  let sx: SpringState = { x: first.x, v: 0 };
  let sy: SpringState = { x: first.y, v: 0 };
  let target = first;
  for (let j = i + 1; j <= end + 1; j++) {
    const e = j <= end ? events[j]! : null;
    if (e && !isPointer(e)) continue;
    const until = e ? Math.max(t, e.t) : rec;
    sx = springStep(sx, target.x, until - t, w);
    sy = springStep(sy, target.y, until - t, w);
    t = until;
    if (e) target = e;
  }
  return { x: sx.x, y: sy.x };
}

/**
 * Cursor position (0..1 of the viewport) at a recording time, smoothed or as recorded, with its click ring.
 * The smooth cursor lands on each click's spot; `ring` is the clicked spot, where the ring is drawn.
 */
export function cursorAt(
  events: RecEvent[], rec: number, smooth: boolean,
): { x: number; y: number; click: number; ring?: { x: number; y: number } } | null {
  const last = lastAt(events, rec);
  const c = ringClick(events, rec, last);
  const ring = c ? { click: 1 - (rec - c.t) / CLICK_MS, ring: { x: c.x, y: c.y } } : { click: 0 };
  if (smooth) {
    const at = smoothAt(events, rec, last);
    if (!at) return null;
    const p = pull(events, rec, last);
    const x = p ? at.x + (p.x - at.x) * p.w : at.x;
    const y = p ? at.y + (p.y - at.y) * p.w : at.y;
    return { x, y, ...ring };
  }
  const p = events[pointerBefore(events, last)];
  return p && isPointer(p) ? { x: p.x, y: p.y, ...ring } : null;
}
