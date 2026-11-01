import type { ClipType, SlotValue, StyleId, TemplateId } from '../types';

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

// ---- v2: hand-made scene fills, at least one per template; the fill call gets the 2 or 3 nearest ----

export interface SceneExample { type: ClipType; template: TemplateId; style: StyleId; line: string; slots: Record<string, SlotValue> }

export const SCENE_EXAMPLES: readonly SceneExample[] = [
  { type: 'promo', template: 'title-hook', style: 'bold', line: 'Running shoes are 30% off this weekend', slots: { kicker: 'This weekend only', headline: '30% off every runner' } },
  { type: 'social', template: 'title-hook', style: 'playful', line: 'Hook: most people water plants wrong', slots: { kicker: 'Plant tip', headline: "You're overwatering. Probably." } },
  { type: 'explainer', template: 'title-hook', style: 'clean', line: 'How compound interest grows your savings', slots: { kicker: 'Money basics', headline: 'Let your money work' } },
  { type: 'promo', template: 'big-statement', style: 'bold', line: 'Cold brew that tastes like the café', slots: { statement: 'Café cold brew, now in a can', highlight: 'can' } },
  { type: 'quote', template: 'big-statement', style: 'corporate', line: 'The idea behind the quote: start small', slots: { statement: 'Every big team started as two people', highlight: 'two' } },
  { type: 'social', template: 'big-statement', style: 'playful', line: 'Mondays are better with a plan', slots: { statement: 'Plan Sunday, win Monday', highlight: 'win' } },
  { type: 'chart', template: 'stat-reveal', style: 'corporate', line: 'Sign-ups tripled this year', slots: { number: '3x', label: 'more sign-ups this year', source: 'Company data, 2026' } },
  { type: 'promo', template: 'stat-reveal', style: 'bold', line: 'Ten thousand happy customers', slots: { number: '10,000', label: 'customers and counting' } },
  { type: 'chart', template: 'chart', style: 'corporate', line: 'Revenue by quarter', slots: { title: 'Revenue by quarter', bars: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 25 }, { label: 'Q4', value: 31 }], note: 'In thousands of dollars' } },
  { type: 'explainer', template: 'chart', style: 'clean', line: 'Sleep hours by age group', slots: { title: 'How much we sleep', bars: [{ label: 'Teens', value: 7 }, { label: 'Adults', value: 6.8 }, { label: 'Seniors', value: 7.5 }] } },
  { type: 'quote', template: 'quote', style: 'corporate', line: 'Maya Angelou on how people remember you', slots: { quote: 'People will never forget how you made them feel.', name: 'Maya Angelou', role: 'Poet' } },
  { type: 'social', template: 'quote', style: 'clean', line: 'A customer on the new app', slots: { quote: 'It does in one tap what took me ten.', name: 'Ada O.', role: 'Customer since 2024' } },
  { type: 'explainer', template: 'list', style: 'clean', line: 'Three things to pack for a day hike', slots: { title: 'Pack these three', items: ['Two litres of water', 'A warm layer', 'A charged phone'] } },
  { type: 'promo', template: 'list', style: 'bold', line: 'What comes in the starter box', slots: { title: "What's in the box", items: ['Six fresh bagels', 'Two cream cheeses', 'Free delivery'] } },
  { type: 'social', template: 'list', style: 'playful', line: 'Desk upgrades under twenty dollars', slots: { title: 'Desk upgrades under $20', items: ['A monitor riser', 'A cable tray', 'One good plant', 'A warm lamp'] } },
  { type: 'promo', template: 'hero', style: 'bold', line: 'The new trail shoe in action', slots: { headline: 'Built for wet trails', line: 'Grip that holds on every descent' } },
  { type: 'social', template: 'hero', style: 'playful', line: 'Sunday at the market', slots: { headline: 'Sunday market vibes' } },
  { type: 'promo', template: 'split', style: 'clean', line: 'The lamp that dims itself at night', slots: { headline: 'Light that knows bedtime', body: 'Dims to a warm glow after 9 pm, so you sleep sooner.' } },
  { type: 'explainer', template: 'split', style: 'corporate', line: 'Why we moved to solar', slots: { headline: 'Why we went solar', body: 'Our roof now covers 80% of the office power.' } },
  { type: 'promo', template: 'before-after', style: 'bold', line: 'The kitchen before and after the remodel', slots: { before: 'Dark and cramped', after: 'Open and bright' } },
  { type: 'social', template: 'before-after', style: 'playful', line: 'My desk before and after a tidy', slots: { before: 'Monday chaos', after: 'Friday calm' } },
  { type: 'explainer', template: 'steps', style: 'clean', line: 'How to brew pour-over coffee', slots: { title: 'Pour-over in 3 steps', steps: ['Rinse the filter', 'Bloom for 30 seconds', 'Pour in slow circles'] } },
  { type: 'promo', template: 'steps', style: 'corporate', line: 'How to get started with the app', slots: { title: 'Start in three steps', steps: ['Download the app', 'Link your bank', 'Set a goal'] } },
  { type: 'logo', template: 'logo-sting', style: 'playful', line: 'Our logo with the tagline', slots: { tagline: 'Baked fresh daily' } },
  { type: 'logo', template: 'logo-sting', style: 'corporate', line: 'Brand reveal', slots: { tagline: 'Built on trust' } },
  { type: 'promo', template: 'end-card', style: 'bold', line: 'Shop the sale now', slots: { cta: 'Shop the sale now', handle: 'stride.shop' } },
  { type: 'social', template: 'end-card', style: 'playful', line: 'Follow for more tips', slots: { cta: 'Follow for more tips', handle: '@greenthumb' } },
  { type: 'explainer', template: 'end-card', style: 'clean', line: 'Learn more on our site', slots: { cta: 'Read the full guide', handle: 'savewell.org' } },
];

/** The 2 or 3 examples nearest a scene: same template first, then same clip type, then same style. */
export function pickExamples(type: ClipType, template: TemplateId, style: StyleId): SceneExample[] {
  const score = (e: SceneExample) => (e.template === template ? 4 : 0) + (e.type === type ? 2 : 0) + (e.style === style ? 1 : 0);
  const ranked = SCENE_EXAMPLES.map((e, i) => ({ e, i, s: score(e) })).sort((a, b) => b.s - a.s || a.i - b.i);
  const third = ranked[2];
  return ranked.slice(0, third && third.e.template === template ? 3 : 2).map((r) => r.e);
}
