import type { Overlay, RecEvent } from './types';

/** First index whose event is after `t` (events are in time order). */
function after(events: readonly RecEvent[], t: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid]!.t <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * How far the page scrolled between rec `from` and `to`, in viewport heights (down is positive).
 * A new page ends the count: what was under the box is gone, so the box stays where it was.
 */
export function scrollBetween(events: readonly RecEvent[], from: number, to: number): number {
  let dy = 0;
  for (let i = after(events, from); i < events.length; i++) {
    const e = events[i]!;
    if (e.t > to || e.type === 'page') break;
    if (e.type === 'scroll') dy += e.dy;
  }
  return dy;
}

/** Where a blur that follows the page sits at rec `t`: its box moves up as the page scrolls down. */
export function followBox(o: Overlay, events: readonly RecEvent[], t: number): Overlay['box'] {
  if (o.kind !== 'blur' || !o.blur?.follow || t <= o.at) return o.box;
  const dy = scrollBetween(events, o.at, t);
  return dy === 0 ? o.box : { ...o.box, y: o.box.y - dy };
}

/** The overlays at rec `t` with following blurs moved; the same array when none moved. */
export function followOverlays(overlays: Overlay[], events: readonly RecEvent[] | undefined, t: number): Overlay[] {
  if (!events?.length) return overlays;
  let moved = false;
  const out = overlays.map((o) => {
    const box = followBox(o, events, t);
    if (box === o.box) return o;
    moved = true;
    return { ...o, box };
  });
  return moved ? out : overlays;
}
