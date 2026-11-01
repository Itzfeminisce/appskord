/** The 2D context both backends draw vector layers with. */
export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** The renderer's typeface; the worker loads Geist, else the system sans. */
export const FONT_FAMILY = 'Geist, system-ui, sans-serif';

/** A rounded rectangle path (radius clamped to the box). */
export function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
