import type { StylePack, TemplateId } from '../../lib/types';

// SwapTemplate tiles: each template's layout in miniature (bars, bullets, a quote mark, a split), on a 56 × 100 grid.

type Ink = 'ink' | 'accent' | 'muted' | 'bg' | 'panel' | 'panel2' | 'photo';
type Part = { x: number; y: number; w: number; h: number; c: Ink; r?: number } | { glyph: string; x: number; y: number; size: number; c: Ink };

const bar = (x: number, y: number, w: number, h: number, c: Ink, r = 1): Part => ({ x, y, w, h, c, r });
const LAYOUTS: Record<TemplateId, Part[]> = {
  'title-hook': [bar(7, 52, 20, 3, 'accent'), bar(7, 59, 40, 6, 'ink'), bar(7, 68, 30, 6, 'ink')],
  'big-statement': [bar(7, 36, 42, 6, 'ink'), bar(7, 45, 22, 6, 'accent'), bar(31, 45, 18, 6, 'ink'), bar(7, 54, 34, 6, 'ink')],
  'stat-reveal': [{ glyph: '1,2', x: 7, y: 30, size: 17, c: 'accent' }, bar(7, 52, 36, 5, 'ink'), bar(0, 76, 56, 24, 'accent', 0)],
  chart: [bar(7, 26, 30, 4, 'ink'), bar(8, 66, 7, 14, 'accent'), bar(19, 58, 7, 22, 'accent'), bar(30, 48, 7, 32, 'accent'), bar(41, 38, 7, 42, 'accent')],
  quote: [{ glyph: '“', x: 6, y: 14, size: 26, c: 'accent' }, bar(7, 42, 42, 4, 'ink'), bar(7, 49, 38, 4, 'ink'), bar(7, 56, 30, 4, 'ink'), bar(7, 70, 16, 3, 'accent')],
  list: [bar(7, 22, 26, 5, 'ink'), bar(7, 34, 5, 5, 'accent', 3), bar(15, 34, 30, 5, 'ink'), bar(7, 46, 5, 5, 'accent', 3), bar(15, 46, 26, 5, 'ink'), bar(7, 58, 5, 5, 'accent', 3), bar(15, 58, 22, 5, 'ink')],
  hero: [bar(0, 0, 56, 100, 'photo', 0), bar(7, 72, 36, 6, 'ink'), bar(7, 82, 26, 3, 'accent')],
  split: [bar(7, 14, 42, 34, 'panel', 8), bar(7, 56, 34, 6, 'ink'), bar(7, 66, 42, 3, 'muted'), bar(7, 72, 36, 3, 'muted')],
  'before-after': [bar(0, 0, 28, 100, 'panel', 0), bar(28, 0, 28, 100, 'panel2', 0), bar(27, 0, 2, 100, 'accent', 0), bar(4, 86, 18, 3, 'ink'), bar(33, 86, 18, 3, 'bg')],
  steps: [1, 2, 3].flatMap((n, i) => [bar(7, 28 + i * 18, 11, 11, 'accent', 6), { glyph: String(n), x: 10, y: 29.5 + i * 18, size: 8, c: 'bg' } as Part, bar(22, 31 + i * 18, 26, 5, 'ink')]),
  'logo-sting': [bar(16, 34, 24, 24, 'accent', 12), bar(14, 66, 28, 3, 'ink')],
  'end-card': [bar(9, 40, 38, 6, 'ink'), bar(12, 54, 32, 12, 'accent', 6), bar(18, 74, 20, 3, 'muted')],
};

export function TemplateMini({ id, pack, w, h }: { id: TemplateId; pack: StylePack; w: number; h: number }) {
  const p = pack.palette;
  const fill: Record<Ink, string> = { ink: p.ink, accent: p.accent, muted: p.muted, bg: p.bg, panel: '#52525B', panel2: '#A8A29E', photo: 'url(#mini-photo)' };
  const font = (glyph: string) => (/\d/.test(glyph) ? pack.fonts.number : pack.fonts.display);
  return (
    <svg width={w} height={h} viewBox="0 0 56 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true" style={{ position: 'absolute', inset: 0, background: p.bg }}>
      <defs><linearGradient id="mini-photo" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stopColor="#78716C" /><stop offset="1" stopColor="#292524" /></linearGradient></defs>
      {LAYOUTS[id].map((part, i) => ('glyph' in part
        ? <text key={i} x={part.x} y={part.y + part.size * 0.8} fontSize={part.size} fontWeight={700} fontFamily={`'${font(part.glyph)}', sans-serif`} fill={fill[part.c]}>{part.glyph}</text>
        : <rect key={i} x={part.x} y={part.y} width={part.w} height={part.h} rx={part.r} fill={fill[part.c]} />))}
    </svg>
  );
}
