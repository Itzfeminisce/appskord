import type { Box, Overlay, RenderPlan } from '../../project/types';
import { box, motionAt, overlayBox } from './geometry';
import { isPrivacy } from './order';
import { FONT_FAMILY, roundRect, type Ctx2D } from './path';

// Colours from the Overlays frame.
const INK = '#111114';
export const SOLID = '#111114';
const HIGHLIGHT = { stroke: '#FB923C', fill: 'rgba(251,146,60,0.18)' };
const SPOTLIGHT_DIM = 'rgba(0,0,0,0.55)';
/** The frame's arrow, drawn in a 60 x 44 box. */
const ARROW = { w: 60, h: 44, curve: [4, 40, 20, 30, 38, 22, 52, 8], head: [42, 8, 53, 7, 51, 18] } as const;

const scratch = box();

type Screen = NonNullable<RenderPlan['screen']>;

/** Text, arrows, callouts, highlights and spotlights over the screen picture. The context is in frame px. */
export function drawOverlays(ctx: Ctx2D, plan: RenderPlan, scale: number): void {
  const screen = plan.screen;
  if (!screen || plan.rec === null) return;
  ctx.save();
  // Overlays belong to the screen picture, so nothing spills past its frame.
  roundRect(ctx, screen.dest.x, screen.dest.y, screen.dest.w, screen.dest.h, screen.radius);
  ctx.clip();
  for (const o of plan.overlays) {
    if (isPrivacy(o)) continue;
    const { alpha, scale: pop } = motionAt(o.motion, o.at, o.end, plan.rec);
    if (alpha <= 0) continue;
    const b = overlayBox(o.box, screen, scratch);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (pop !== 1) {
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.scale(pop, pop);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
    drawOverlay(ctx, o, b, screen, scale);
    ctx.restore();
  }
  ctx.restore();
}

function drawOverlay(ctx: Ctx2D, o: Overlay, b: Box, screen: Screen, scale: number): void {
  switch (o.kind) {
    case 'text': {
      const size = fitText(ctx, o.text ?? '', 700, b);
      ctx.font = `700 ${size}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = size * 0.2 * scale;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(o.text ?? '', b.x + b.w / 2, b.y + b.h / 2);
      return;
    }
    case 'callout': {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = b.h * 0.6 * scale;
      ctx.shadowOffsetY = b.h * 0.2 * scale;
      ctx.fillStyle = INK;
      roundRect(ctx, b.x, b.y, b.w, b.h, Math.min(b.h * 0.3, 24));
      ctx.fill();
      ctx.restore();
      const size = fitText(ctx, o.text ?? '', 600, { w: b.w * 0.86, h: b.h * 0.64 });
      ctx.font = `600 ${size}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(o.text ?? '', b.x + b.w / 2, b.y + b.h / 2);
      return;
    }
    case 'arrow': {
      const sx = b.w / ARROW.w;
      const sy = b.h / ARROW.h;
      const [a, c, d, e, f, g, h, i] = ARROW.curve;
      const [j, k, l, m, n, p] = ARROW.head;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3 * Math.min(sx, sy);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x + a * sx, b.y + c * sy);
      ctx.bezierCurveTo(b.x + d * sx, b.y + e * sy, b.x + f * sx, b.y + g * sy, b.x + h * sx, b.y + i * sy);
      ctx.moveTo(b.x + j * sx, b.y + k * sy);
      ctx.lineTo(b.x + l * sx, b.y + m * sy);
      ctx.lineTo(b.x + n * sx, b.y + p * sy);
      ctx.stroke();
      return;
    }
    case 'highlight': {
      const r = Math.min(b.w, b.h) * 0.15;
      ctx.fillStyle = HIGHLIGHT.fill;
      roundRect(ctx, b.x, b.y, b.w, b.h, r);
      ctx.fill();
      ctx.strokeStyle = HIGHLIGHT.stroke;
      ctx.lineWidth = 4;
      ctx.stroke();
      return;
    }
    case 'spotlight': {
      const d = screen.dest;
      ctx.fillStyle = SPOTLIGHT_DIM;
      ctx.beginPath();
      ctx.rect(d.x, d.y, d.w, d.h);
      roundRectInto(ctx, b, Math.min(b.w, b.h) * 0.15);
      ctx.fill('evenodd');
      return;
    }
    default:
  }
}

// A rounded rect added to the current path, so spotlight can cut a hole with even-odd.
function roundRectInto(ctx: Ctx2D, b: Box, r: number): void {
  const rr = Math.max(0, Math.min(r, b.w / 2, b.h / 2));
  ctx.moveTo(b.x + rr, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, rr);
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, rr);
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, rr);
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, rr);
  ctx.closePath();
}

/** The largest font size (frame px) at which `text` fits the box on one line. */
export function fitText(ctx: Pick<Ctx2D, 'font' | 'measureText'>, text: string, weight: number, b: Pick<Box, 'w' | 'h'>): number {
  const size = Math.max(1, b.h * 0.7);
  if (!text) return size;
  ctx.font = `${weight} ${size}px ${FONT_FAMILY}`;
  const w = ctx.measureText(text).width;
  return w > b.w && w > 0 ? Math.max(1, (size * b.w) / w) : size;
}
