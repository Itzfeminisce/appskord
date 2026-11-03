/** AI replies checked against CONTRACT "AI replies". Pure: a reply either fits, or says why not, so the caller can ask once more. */
import { extractJson } from '@appskord/llm';
import type { DiagramNodeKind } from '../board/types';

export interface SummaryReply { title: string; summary: string }
export interface DiagramReply {
  nodes: { id: string; kind: DiagramNodeKind; label: string }[];
  edges: { from: string; to: string; label?: string }[];
}
export interface OrderReply { order: string[]; reasons: { card: string; why: string }[] }
export interface BriefReply { points: { text: string; cards: number[] }[]; questions: string[]; missing: string[] }

export type Parsed<T> = { ok: true; value: T } | { ok: false; why: string };

const NODE_KINDS: readonly DiagramNodeKind[] = ['step', 'choice', 'end', 'text'];
const MAX_NODES = 40;
const MAX_LABEL = 80;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const bad = <T>(why: string): Parsed<T> => ({ ok: false, why });

/** The reply's JSON object, also when the model wrapped it in prose or a code fence. */
function object(reply: string): Obj | undefined {
  try {
    const value: unknown = JSON.parse(extractJson(reply));
    return isObj(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Strings from a list; anything else in it is left out. A missing list is empty. */
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map(text).filter((s): s is string => !!s) : []);

export function parseSummary(reply: string): Parsed<SummaryReply> {
  const o = object(reply);
  if (!o) return bad('not a JSON object');
  const title = text(o.title);
  const summary = text(o.summary);
  if (!title) return bad('no title');
  if (!summary) return bad('no summary');
  return { ok: true, value: { title, summary } };
}

export function parseDiagram(reply: string): Parsed<DiagramReply> {
  const o = object(reply);
  if (!o) return bad('not a JSON object');
  if (!Array.isArray(o.nodes) || o.nodes.length === 0) return bad('no nodes');
  if (o.nodes.length > MAX_NODES) return bad('too many nodes');
  const nodes: DiagramReply['nodes'] = [];
  const ids = new Set<string>();
  for (const n of o.nodes) {
    if (!isObj(n)) return bad('a node is not an object');
    const id = typeof n.id === 'number' ? String(n.id) : text(n.id);
    const label = text(n.label);
    const kind = NODE_KINDS.find((k) => k === n.kind);
    if (!id || ids.has(id)) return bad('a node id is missing or repeated');
    if (!label) return bad(`node ${id} has no label`);
    if (!kind) return bad(`node ${id} has an unknown kind`);
    ids.add(id);
    nodes.push({ id, kind, label: label.slice(0, MAX_LABEL) });
  }
  const edges: DiagramReply['edges'] = [];
  for (const e of Array.isArray(o.edges) ? o.edges : []) {
    if (!isObj(e)) return bad('an edge is not an object');
    const from = typeof e.from === 'number' ? String(e.from) : text(e.from);
    const to = typeof e.to === 'number' ? String(e.to) : text(e.to);
    if (!from || !to || !ids.has(from) || !ids.has(to)) return bad('an edge names a missing node');
    const label = text(e.label);
    edges.push(label ? { from, to, label: label.slice(0, MAX_LABEL) } : { from, to });
  }
  // Every step must join the flow; free text notes may stand alone.
  const joined = new Set(edges.flatMap((e) => [e.from, e.to]));
  if (nodes.length > 1 && nodes.some((n) => n.kind !== 'text' && !joined.has(n.id))) return bad('the steps do not connect');
  return { ok: true, value: { nodes, edges } };
}

/** `cardIds`: every card that was sent; the order must name each of them exactly once. */
export function parseOrder(reply: string, cardIds: readonly string[]): Parsed<OrderReply> {
  const o = object(reply);
  if (!o) return bad('not a JSON object');
  if (!Array.isArray(o.order)) return bad('no order');
  const known = new Set(cardIds);
  const order: string[] = [];
  for (const id of o.order) {
    if (typeof id !== 'string' || !known.has(id)) return bad('the order names a card that was not sent');
    if (order.includes(id)) return bad('the order names a card twice');
    order.push(id);
  }
  if (order.length !== known.size) return bad('the order leaves out a card');
  const reasons = (Array.isArray(o.reasons) ? o.reasons : []).flatMap((r) => {
    if (!isObj(r)) return [];
    const card = text(r.card);
    const why = text(r.why);
    return card && why && known.has(card) ? [{ card, why }] : [];
  });
  return { ok: true, value: { order, reasons } };
}

/** `cardCount`: the cards were sent numbered 1 to `cardCount`; other numbers are left out. */
export function parseBrief(reply: string, cardCount: number): Parsed<BriefReply> {
  const o = object(reply);
  if (!o) return bad('not a JSON object');
  if (!Array.isArray(o.points)) return bad('no talking points');
  const points = o.points.flatMap((p) => {
    if (!isObj(p)) return [];
    const t = text(p.text);
    if (!t) return [];
    const cards = Array.isArray(p.cards) ? p.cards.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= cardCount) : [];
    return [{ text: t, cards: [...new Set(cards)] }];
  });
  if (points.length === 0) return bad('no usable talking points');
  return { ok: true, value: { points, questions: texts(o.questions), missing: texts(o.missing) } };
}
