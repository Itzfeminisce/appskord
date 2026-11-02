// The thumbnail's optional title: Bold (large white words on the picture) or Clean (dark words on a white card).
import type { TitleStyle } from './protocol';

type Ctx = Pick<OffscreenCanvasRenderingContext2D, 'font' | 'fillStyle' | 'textBaseline' | 'shadowColor' | 'shadowBlur' | 'measureText' | 'fillText' | 'beginPath' | 'roundRect' | 'fill'>;

/** Breaks `text` into lines no wider than `max`; at most three, the last cut with "…". */
export function titleLines(text: string, max: number, measure: (s: string) => number, most = 3): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  kept[most - 1] = `${kept[most - 1]}…`;
  return kept;
}

export function drawTitle(ctx: Ctx, text: string, style: Exclude<TitleStyle, 'none'>, width: number, height: number): void {
  const pad = Math.round(height * 0.07);
  ctx.textBaseline = 'top';
  if (style === 'bold') {
    const size = Math.round(height * 0.11);
    ctx.font = `800 ${size}px Geist, sans-serif`;
    const lines = titleLines(text, width * 0.72, (s) => ctx.measureText(s).width);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = size * 0.4;
    ctx.fillStyle = '#FFFFFF';
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + i * size * 1.1));
    ctx.shadowBlur = 0;
    return;
  }
  const size = Math.round(height * 0.065);
  ctx.font = `600 ${size}px Geist, sans-serif`;
  const lines = titleLines(text, width * 0.6, (s) => ctx.measureText(s).width);
  const inner = Math.round(size * 0.6);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + inner * 2;
  const h = lines.length * size * 1.2 + inner * 2 - size * 0.2;
  const y = height - pad - h;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(pad, y, w, h, size * 0.35);
  ctx.fill();
  ctx.fillStyle = '#16161A';
  lines.forEach((l, i) => ctx.fillText(l, pad + inner, y + inner + i * size * 1.2));
}
