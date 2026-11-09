const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
/** A colour between two, for the Panel and Muted slots a pack leaves out. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [hex(a), hex(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}
/** The guide's palette in Ground, Ink, Glow, Panel, Muted order. */
export function fivePalette(p: readonly string[]): string[] {
  const [ground = '#0B0B10', ink = '#F5F5F7', glow = '#8B9CFF'] = p;
  return [ground, ink, glow, p[3] ?? mix(ground, ink, 0.1), p[4] ?? mix(ground, ink, 0.55)];
}
