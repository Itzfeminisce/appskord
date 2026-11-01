import type { RenderPlan } from '../../project/types';
import type { Ctx2D } from './path';

/** Cursor height at size 1, frame px. */
export const CURSOR_PX = 36;
/** The click ring colour from the Overlays frame. */
const RING = '37,99,235';
// The pointer from the frames, a 24-unit icon whose tip is at (4, 4).
const POINTER = [4, 4, 11, 21, 13.5, 13.5, 21, 11] as const;

/** The click ring around the tip: grows as it fades. `click` is 1 at the click, 0 when gone. */
export function clickRing(click: number, height: number): { radius: number; alpha: number; width: number } {
  return { radius: height * (0.35 + 0.45 * (1 - click)), alpha: 0.6 * click, width: height * 0.08 };
}

/** The smooth cursor and its click ring, drawn on the clicked spot. The context is in frame px. */
export function drawCursor(ctx: Ctx2D, cursor: NonNullable<RenderPlan['cursor']>): void {
  const h = CURSOR_PX * Math.max(0.25, cursor.size);
  ctx.save();
  if (cursor.click > 0) {
    const ring = clickRing(cursor.click, h);
    ctx.strokeStyle = `rgba(${RING},${ring.alpha})`;
    ctx.lineWidth = ring.width;
    const at = cursor.ring ?? cursor;
    ctx.beginPath();
    ctx.arc(at.x, at.y, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  const k = h / 18;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = POINTER;
  ctx.translate(cursor.x - x0 * k, cursor.y - y0 * k);
  ctx.beginPath();
  ctx.moveTo(x0 * k, y0 * k);
  ctx.lineTo(x1 * k, y1 * k);
  ctx.lineTo(x2 * k, y2 * k);
  ctx.lineTo(x3 * k, y3 * k);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#111114';
  ctx.lineWidth = 1.5 * k;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}
