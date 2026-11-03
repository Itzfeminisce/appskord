/** Pure board changes for AI results. Each is applied by the caller as one undo step. */
import { addArrow, addCard, cardNumbers, sectionOf, updateCard } from '../board/ops';
import type { Board, Diagram, DiagramCard, KeptBrief, LinkCard, NoteCard, Rect } from '../board/types';
import { NODE_COLOUR } from '../diagram/edit';
import { layoutDiagram } from '../diagram/layout';
import type { BriefReply, DiagramReply, SummaryReply } from './parse';

/** Which model wrote a result. */
export interface AiMeta { model: string; provider: string }

const GAP = 80;
const STACK_GAP = 24;
const DIAGRAM_SIZE = { w: 380, h: 262 };

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `rect`, moved down past any card it would cover. */
export function freeSpot(board: Board, rect: Rect): Rect {
  let at = { ...rect };
  for (let i = 0; i < 200; i++) {
    const hit = Object.values(board.cards).find((c) => overlaps(at, c.rect));
    if (!hit) return at;
    at = { ...at, y: hit.rect.y + hit.rect.h + STACK_GAP };
  }
  return at;
}

/** A free spot for a `size` card beside `next`: right of it, else below, left or above, else further right. */
export function besideSpot(board: Board, next: Rect, { w, h }: { w: number; h: number }): Rect {
  const size = { w, h };
  const free = (r: Rect) => !Object.values(board.cards).some((c) => overlaps(r, c.rect));
  const tries: Rect[] = [
    { x: next.x + next.w + GAP, y: next.y, ...size },
    { x: next.x, y: next.y + next.h + GAP, ...size },
    { x: next.x - GAP - size.w, y: next.y, ...size },
    { x: next.x, y: next.y - GAP - size.h, ...size },
  ];
  const found = tries.find(free);
  if (found) return found;
  let at = tries[0]!;
  for (let i = 0; i < 200; i++) {
    const hit = Object.values(board.cards).find((c) => overlaps(at, c.rect));
    if (!hit) return at;
    at = { ...at, x: hit.rect.x + hit.rect.w + STACK_GAP };
  }
  return at;
}

/** The top-left of empty canvas to the right of every card. */
export function rightOfAll(board: Board): { x: number; y: number } {
  const cards = Object.values(board.cards);
  // Clear of the canvas tools on the left.
  if (cards.length === 0) return { x: 120, y: 60 };
  return { x: Math.max(...cards.map((c) => c.rect.x + c.rect.w)) + GAP, y: Math.min(...cards.map((c) => c.rect.y)) };
}

/** A note tall enough for `text` at `w` wide. */
const noteHeight = (text: string, w: number) => {
  const perLine = Math.max(20, Math.floor((w - 32) / 7));
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.min(520, Math.max(150, 76 + lines * 20));
};

const note = (id: string, now: number, rect: Rect, fields: Pick<NoteCard, 'title' | 'text' | 'colour'> & Partial<NoteCard>): NoteCard => ({
  id, kind: 'note', z: 0, say: '', createdAt: now, updatedAt: now, rect, ...fields,
});

// ---- Summarize ----

export function summaryNote(link: LinkCard, reply: SummaryReply, meta: AiMeta, id: string, now: number): NoteCard {
  const w = 340;
  // addSummary finds the free spot beside the link.
  const rect = { x: link.rect.x + link.rect.w + GAP, y: link.rect.y, w, h: noteHeight(reply.summary, w) };
  return note(id, now, rect, {
    title: reply.title, text: reply.summary, colour: 'white',
    summary: { of: link.id, model: meta.model, provider: meta.provider, from: link.savedAt },
  });
}

/** The summary next to its link, joined by a dashed arrow, and right after the link in the list. */
export function addSummary(board: Board, linkId: string, summary: NoteCard, arrowId: string, now: number): Board {
  const link = board.cards[linkId];
  if (!link) return board;
  const section = sectionOf(board, linkId);
  const placed = { ...summary, rect: besideSpot(board, link.rect, summary.rect) };
  const added = addCard(board, placed, now, section ? { sectionId: section.id, index: section.cards.indexOf(linkId) + 1 } : {});
  return addArrow(added, { id: arrowId, from: linkId, to: summary.id, dashed: true }, now);
}

// ---- Diagram ----

/** The reply laid out by `layoutDiagram`; nodes kept from `current` keep their colour and linked card. */
export function diagramFromReply(reply: DiagramReply, current?: Diagram): Diagram {
  const old = new Map(current?.nodes.map((n) => [n.id, n]));
  const nodes = reply.nodes.map((n) => {
    const was = old.get(n.id);
    const keep = was && was.kind === n.kind;
    return {
      id: n.id, kind: n.kind, label: n.label,
      colour: keep ? was.colour : NODE_COLOUR[n.kind],
      ...(keep && was.card ? { card: was.card } : {}),
    };
  });
  const edges = reply.edges.map((e, i) => ({ id: `e${i + 1}`, from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) }));
  return layoutDiagram({ nodes, edges });
}

/** "Preview · 6 steps, 1 choice". */
export function diagramCounts(diagram: Diagram): { steps: number; choices: number } {
  const choices = diagram.nodes.filter((n) => n.kind === 'choice').length;
  return { steps: diagram.nodes.filter((n) => n.kind === 'step' || n.kind === 'end').length, choices };
}

export function addDiagramCard(board: Board, diagram: Diagram, id: string, now: number): Board {
  const card: DiagramCard = {
    id, kind: 'diagram', title: '', colour: 'white', z: 0, say: '', createdAt: now, updatedAt: now, diagram,
    rect: freeSpot(board, { ...rightOfAll(board), ...DIAGRAM_SIZE }),
  };
  return addCard(board, card, now);
}

export function replaceDiagram(board: Board, cardId: string, diagram: Diagram, now: number): Board {
  return updateCard(board, cardId, now, (c) => (c.kind === 'diagram' ? { ...c, diagram } : c));
}

// ---- Suggest an order ----

export type Move = { kind: 'stays' } | { kind: 'near'; from: number } | { kind: 'up'; from: number } | { kind: 'down'; from: number };

/** Indexes into `seq` of one longest increasing run, found in O(n log n). */
function longestRun(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = [];
  for (let i = 0; i < seq.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < seq[i]!) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1]! : -1;
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) keep.add(i);
  return keep;
}

/**
 * How each card moves from `current` to `next`: the fewest cards are "moved" (Up from / Down from);
 * the rest keep their relative order and only "stay" or "stay near" their old number.
 */
export function orderMoves(current: readonly string[], next: readonly string[]): { id: string; move: Move }[] {
  const was = new Map(current.map((id, i) => [id, i]));
  const seq = next.map((id) => was.get(id) ?? Number.MAX_SAFE_INTEGER);
  const kept = longestRun(seq);
  return next.map((id, i) => {
    const old = was.get(id);
    if (old === undefined || old === i) return { id, move: { kind: 'stays' } };
    if (kept.has(i)) return { id, move: { kind: 'near', from: old + 1 } };
    return { id, move: { kind: i < old ? 'up' : 'down', from: old + 1 } };
  });
}

export const movedCount = (moves: readonly { move: Move }[]): number => moves.filter((m) => m.move.kind === 'up' || m.move.kind === 'down').length;

// ---- Brief me ----

/** The points with card ids, from the numbers the cards were sent with (`cardIds[n - 1]`). */
export function keptBrief(reply: BriefReply, cardIds: readonly string[], meta: AiMeta, now: number): KeptBrief {
  return {
    at: now, model: meta.model, provider: meta.provider,
    points: reply.points.map((p) => ({ text: p.text, cards: p.cards.map((n) => cardIds[n - 1]).filter((id): id is string => !!id) })),
    questions: reply.questions,
  };
}

export function withBrief(board: Board, brief: KeptBrief, now: number): Board {
  return { ...board, brief, updatedAt: now };
}

/** The kept points about one card, for meeting mode. */
export const briefPointsFor = (board: Board, cardId: string): string[] =>
  (board.brief?.points ?? []).filter((p) => p.cards.includes(cardId)).map((p) => p.text);

/** The brief as text, for "Copy" and "Add as a note card"; cards by their numbers now. */
export function briefText(board: Board, brief: KeptBrief, missing: readonly string[]): string {
  const numbers = cardNumbers(board);
  const refs = (ids: string[]) => ids.map((id) => numbers[id]).filter((n): n is number => n !== undefined);
  const parts = [['Talking points', ...brief.points.map((p, i) => `${i + 1}. ${p.text}${refs(p.cards).length ? ` (${refs(p.cards).join(', ')})` : ''}`)].join('\n')];
  if (brief.questions.length) parts.push(['Open questions', ...brief.questions.map((q) => `- ${q}`)].join('\n'));
  if (missing.length) parts.push(['Not on the board yet', ...missing.map((m) => `- ${m}`)].join('\n'));
  return parts.join('\n\n');
}

/** The brief as a note card to the right of the board. */
export function addBriefNote(board: Board, text: string, id: string, now: number): Board {
  const w = 300;
  const rect = freeSpot(board, { ...rightOfAll(board), w, h: noteHeight(text, w) });
  return addCard(board, note(id, now, rect, { title: 'Brief me', text, colour: 'yellow' }), now);
}
