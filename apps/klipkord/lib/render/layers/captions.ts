import type { RenderPlan } from '../../project/types';
import type { Size } from './geometry';
import { FONT_FAMILY, roundRect, type Ctx2D } from './path';

type Captions = NonNullable<RenderPlan['captions']>;

/** The spoken word in "Word by word", as in the Captions frame. */
export const WORD_ON = '#FDBA74';
const LOOKS = {
  clean: { weight: 500, box: '', pad: [0, 0], radius: 0 },
  bold: { weight: 800, box: '#111114', pad: [0.4, 0.15], radius: 0.2 },
  word: { weight: 700, box: 'rgba(17,17,20,0.82)', pad: [10 / 15, 5 / 15], radius: 8 / 15 },
} as const;
/** Captions keep this share of the frame clear at the top or bottom, so they sit in a phone's safe area too. */
export const CAPTION_MARGIN = { top: 0.1, bottom: 0.14 };
const MAX_WIDTH = 0.84;
const LINE = 1.3;

export interface CaptionWord { text: string; x: number; w: number; hot: boolean }
export interface CaptionLayout {
  font: string; size: number; lineHeight: number; box: string; radius: number;
  /** The box behind every line, frame px; text sits inside it by the padding. */
  x: number; y: number; w: number; h: number;
  lines: { y: number; words: CaptionWord[] }[];
}

/** Lines, word positions and the box for a caption, frame px. `measure` gives a text's width in that font. */
export function layoutCaption(captions: Captions, frame: Size, measure: (text: string, font: string) => number): CaptionLayout {
  const { style } = captions;
  const look = LOOKS[style.style];
  const size = Math.max(8, style.size);
  const font = `${look.weight} ${size}px ${FONT_FAMILY}`;
  const padX = look.pad[0] * size;
  const padY = look.pad[1] * size;
  const lineHeight = size * LINE;
  const space = measure(' ', font);
  const max = frame.w * MAX_WIDTH - 2 * padX;
  const hot = style.style === 'word' ? captions.words.findLastIndex((w) => w.on) : -1;

  const rows: { w: number; words: CaptionWord[] }[] = [];
  let row: { w: number; words: CaptionWord[] } | undefined;
  captions.words.forEach((word, i) => {
    const w = measure(word.text, font);
    if (!row || (row.words.length && row.w + space + w > max)) rows.push((row = { w: 0, words: [] }));
    const x = row.words.length ? row.w + space : 0;
    row.words.push({ text: word.text, x, w, hot: i === hot });
    row.w = x + w;
  });

  const width = Math.max(0, ...rows.map((r) => r.w));
  const boxW = width + 2 * padX;
  const boxH = rows.length * lineHeight + 2 * padY;
  const x = (frame.w - boxW) / 2;
  const y = style.position === 'top' ? frame.h * CAPTION_MARGIN.top
    : style.position === 'middle' ? (frame.h - boxH) / 2
    : frame.h * (1 - CAPTION_MARGIN.bottom) - boxH;
  const lines = rows.map((r, i) => {
    const left = x + padX + (width - r.w) / 2;
    for (const word of r.words) word.x += left;
    return { y: y + padY + i * lineHeight + lineHeight / 2, words: r.words };
  });
  return { font, size, lineHeight, box: look.box, radius: look.radius * size, x, y, w: boxW, h: boxH, lines };
}

/** Draws a caption; the context is in frame px, `scale` canvas px per frame px (shadows ignore the transform). */
export function drawCaption(ctx: Ctx2D, layout: CaptionLayout, scale: number): void {
  ctx.save();
  if (layout.box) {
    ctx.fillStyle = layout.box;
    roundRect(ctx, layout.x, layout.y, layout.w, layout.h, layout.radius);
    ctx.fill();
  } else {
    // Clean has no box, so a soft shadow keeps it readable on a light screen.
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = layout.size * 0.25 * scale;
  }
  ctx.font = layout.font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const line of layout.lines) {
    for (const word of line.words) {
      ctx.fillStyle = word.hot ? WORD_ON : '#FFFFFF';
      ctx.fillText(word.text, word.x, line.y);
    }
  }
  ctx.restore();
}
