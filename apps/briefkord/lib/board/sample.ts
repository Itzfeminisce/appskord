/** The one sample board the frames use (FRAMES.md, consistency rules): 7 cards in 3 sections. */
import type { Board, Card, CardBase, Diagram } from './types';

const DIAGRAM: Diagram = {
  nodes: [
    { id: 'cart', kind: 'step', label: 'Cart', x: 16, y: 22, w: 72, h: 34, colour: 'white' },
    { id: 'address', kind: 'step', label: 'Address', x: 112, y: 22, w: 72, h: 34, colour: 'white' },
    { id: 'payment', kind: 'step', label: 'Payment', x: 208, y: 22, w: 72, h: 34, colour: 'white' },
    { id: 'confirm', kind: 'step', label: 'Confirm', x: 296, y: 22, w: 68, h: 34, colour: 'white' },
    { id: 'saved', kind: 'choice', label: 'Card saved?', x: 196, y: 96, w: 96, h: 54, colour: 'yellow' },
    { id: 'leave', kind: 'end', label: '38% leave here', x: 30, y: 164, w: 120, h: 34, colour: 'rose' },
  ],
  edges: [
    { id: 'e1', from: 'cart', to: 'address' },
    { id: 'e2', from: 'address', to: 'payment' },
    { id: 'e3', from: 'payment', to: 'confirm' },
    { id: 'e4', from: 'payment', to: 'saved' },
    { id: 'e5', from: 'saved', to: 'leave', label: 'no' },
    { id: 'e6', from: 'saved', to: 'confirm', label: 'yes' },
  ],
};

/** "Checkout redesign review", stamped with `now`. */
export function sampleBoard(now: number, id = 'sample'): Board {
  const base = (cardId: string, title: string, z: number, x: number, y: number, w: number, h: number): Omit<CardBase, 'kind'> => ({
    id: cardId,
    title,
    colour: 'white',
    rect: { x, y, w, h },
    z,
    say: '',
    createdAt: now,
    updatedAt: now,
  });
  const cards: Card[] = [
    {
      ...base('why-now', 'Why now', 1, 846, 44, 220, 150),
      kind: 'note',
      colour: 'yellow',
      text: 'Drop-off at payment is 38%, up from 29% in June. Support gets 40 “card declined” tickets a week.',
    },
    {
      ...base('findings', 'Checkout usability: 18 findings from user tests', 2, 548, 44, 264, 214),
      kind: 'link',
      url: 'https://baymard.com/',
      site: 'baymard.com',
      text: '',
      words: 0,
      savedAt: now,
      say: 'Findings 4 and 11 match what support hears.',
    },
    {
      ...base('flow', 'Checkout flow today', 3, 110, 60, 380, 262),
      kind: 'diagram',
      diagram: DIAGRAM,
      say: 'Walk left to right. Stop at Payment: this is where 38% leave.\nAsk: do we keep saved cards in v1?',
    },
    {
      ...base('step-2', 'Current checkout, step 2', 4, 548, 290, 264, 210),
      kind: 'image',
      file: { id: 'step-2-png', name: 'Current checkout, step 2.png', mime: 'image/png', size: 412_000 },
    },
    {
      ...base('report', 'Q3 conversion report.pdf', 5, 1098, 44, 228, 120),
      kind: 'file',
      file: { id: 'report-pdf', name: 'Q3 conversion report.pdf', mime: 'application/pdf', size: 2_400_000 },
      pages: 12,
    },
    {
      ...base('new-checkout', 'New checkout, one page', 6, 1098, 194, 228, 196),
      kind: 'link',
      url: 'https://www.figma.com/',
      site: 'figma.com',
      text: '',
      words: 0,
      savedAt: now,
    },
    {
      ...base('before-ship', 'Before we ship', 7, 846, 240, 220, 176),
      kind: 'checklist',
      items: [
        { id: 'legal', text: 'Legal ok on saved cards', done: true },
        { id: 'ab', text: 'A/B test plan signed off', done: false },
        { id: 'macros', text: 'Support macros updated', done: false },
      ],
    },
  ];
  return {
    version: 1,
    id,
    name: 'Checkout redesign review',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    arrows: [],
    groups: [{ id: 'payment-flow', title: 'Payment flow', cards: ['flow'] }],
    sections: [
      { id: 'context', title: 'Context', minutes: 2, cards: ['why-now', 'findings'] },
      { id: 'the-flow', title: 'The flow', minutes: 6, cards: ['flow', 'step-2'] },
      { id: 'decisions', title: 'Decisions', minutes: 7, cards: ['report', 'new-checkout', 'before-ship'] },
    ],
  };
}
