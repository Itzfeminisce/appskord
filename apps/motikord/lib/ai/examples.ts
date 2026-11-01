import type { ClipType } from '../types';

// Few-shot recipes in the compact reply shape, modelled on the best templates (product-drop, three-steps, bold-quote).
type L = Record<string, unknown>;
const m = (preset: string, feel: string, durationMs: number) => ({ preset, feel, durationMs });
const text = (id: string, role: string, t: string, box: L, sizePx: number, colour: string, startMs: number, endMs: number, motion: L, extra: L = {}) =>
  ({ id, name: role[0]!.toUpperCase() + role.slice(1), type: 'text', role, text: t, sizePx, weight: role === 'title' ? 800 : role === 'label' ? 600 : 500, colour, startMs, endMs, box, ...motion, ...extra });
const shape = (id: string, name: string, s: string, fill: string, box: L, startMs: number, endMs: number, motion: L, extra: L = {}) =>
  ({ id, name, type: 'shape', shape: s, fill, startMs, endMs, box, ...motion, ...extra });

/** Four scenes, one idea each: hook, proof, detail, call to action. */
const MULTI = {
  name: 'Fern cold brew launch',
  scenes: [
    { id: 's1', durationMs: 3000, background: '#0F172A', layout: 'center', layers: [
      shape('b1', 'Sun', 'circle', '#F59E0B', { x: 0.3, y: 0.16, w: 0.4, h: 0.22 }, 0, 3000, { in: m('grow-in', 'smooth', 700), during: m('float', 'steady', 2000), out: m('fade-out', 'smooth', 400) }),
      text('t1', 'label', 'NEW FROM FERN', { x: 0.1, y: 0.42, w: 0.8, h: 0.05 }, 40, '#F59E0B', 0, 3000, { in: m('fade-in', 'smooth', 500), out: m('fade-out', 'smooth', 400) }),
      text('t2', 'title', 'Mornings just got colder', { x: 0.1, y: 0.48, w: 0.8, h: 0.18 }, 104, '#FFFFFF', 300, 3000, { in: m('pop-in', 'bouncy', 600), out: m('rise-out', 'snappy', 400) }),
    ] },
    { id: 's2', durationMs: 3000, background: '#F59E0B', layout: 'top', layers: [
      shape('b2', 'Card', 'rect', '#0F172A', { x: 0.1, y: 0.3, w: 0.8, h: 0.36 }, 0, 3000, { in: m('wipe-in', 'smooth', 600), out: m('wipe-out', 'smooth', 500) }, { radius: 32 }),
      text('t3', 'title', 'Brewed for 18 hours', { x: 0.14, y: 0.34, w: 0.72, h: 0.17 }, 80, '#FFFFFF', 300, 3000, { in: m('slide-in', 'snappy', 600), out: m('slide-out', 'snappy', 500) }),
      text('t4', 'body', 'Smooth, never bitter', { x: 0.14, y: 0.53, w: 0.72, h: 0.07 }, 52, '#FDE68A', 700, 3000, { in: m('fade-in', 'smooth', 600), out: m('fade-out', 'smooth', 400) }),
    ] },
    { id: 's3', durationMs: 3000, background: '#FFFBEB', layout: 'split', layers: [
      text('t5', 'title', 'Zero sugar. All kick.', { x: 0.1, y: 0.28, w: 0.8, h: 0.17 }, 84, '#0F172A', 0, 3000, { in: m('blur-in', 'smooth', 700), during: m('slow-zoom', 'steady', 2000), out: m('fade-out', 'smooth', 400) }, { align: 'left' }),
      shape('b3', 'Rule', 'rect', '#F59E0B', { x: 0.1, y: 0.47, w: 0.2, h: 0.008 }, 500, 3000, { in: m('wipe-in', 'smooth', 600) }),
      text('t6', 'body', 'Oat or classic, in a can', { x: 0.1, y: 0.5, w: 0.8, h: 0.07 }, 48, '#334155', 700, 3000, { in: m('rise-in', 'smooth', 600), out: m('fade-out', 'smooth', 400) }, { align: 'left' }),
    ] },
    { id: 's4', durationMs: 3000, background: '#0F172A', layout: 'bottom', layers: [
      text('t7', 'title', 'Grab yours Monday', { x: 0.1, y: 0.34, w: 0.8, h: 0.17 }, 88, '#FFFFFF', 0, 3000, { in: m('drop-in', 'bouncy', 600), during: m('pulse', 'snappy', 1000), out: m('pop-out', 'snappy', 400) }),
      shape('b4', 'Button', 'rect', '#F59E0B', { x: 0.25, y: 0.56, w: 0.5, h: 0.08 }, 500, 3000, { in: m('pop-in', 'bouncy', 500), out: m('fade-out', 'smooth', 400) }, { radius: 40 }),
      text('t8', 'label', 'In stores near you', { x: 0.25, y: 0.575, w: 0.5, h: 0.05 }, 40, '#0F172A', 700, 3000, { in: m('fade-in', 'smooth', 500), out: m('fade-out', 'smooth', 400) }),
    ] },
  ],
};

/** Two scenes: the words with a rule and a byline, then a short closing beat. */
const SHORT = {
  name: 'Start before ready',
  scenes: [
    { id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers: [
      shape('b1', 'Rule', 'rect', '#BE185D', { x: 0.1, y: 0.3, w: 0.14, h: 0.006 }, 0, 4000, { in: m('wipe-in', 'smooth', 600) }),
      text('t1', 'title', '“Start before you’re ready.”', { x: 0.1, y: 0.34, w: 0.8, h: 0.24 }, 100, '#FFFFFF', 200, 4000, { in: m('rise-in', 'smooth', 700), during: m('float', 'steady', 2000), out: m('fade-out', 'smooth', 500) }, { align: 'left' }),
      text('t2', 'caption', 'A note to self', { x: 0.1, y: 0.61, w: 0.8, h: 0.06 }, 44, '#C9C9CF', 900, 4000, { in: m('fade-in', 'smooth', 600), out: m('fade-out', 'smooth', 400) }, { align: 'left' }),
    ] },
    { id: 's2', durationMs: 2500, background: '#BE185D', layout: 'center', layers: [
      text('t3', 'title', 'Begin today', { x: 0.1, y: 0.42, w: 0.8, h: 0.14 }, 112, '#FFFFFF', 0, 2500, { in: m('pop-in', 'bouncy', 600), during: m('pulse', 'snappy', 1000), out: m('fade-out', 'smooth', 400) }),
    ] },
  ],
};

export const EXAMPLE_DRAFTS = { MULTI, SHORT } as const;

/** The one example that suits the type, as compact JSON for the prompt. */
export function exampleFor(type: ClipType): string {
  return JSON.stringify(type === 'quote' || type === 'logo' ? SHORT : MULTI);
}
