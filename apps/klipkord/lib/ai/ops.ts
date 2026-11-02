import type { ChatMessage } from '../llm';
import type { Unit } from '../wordCuts';
import { MAX_DEPTH, MIN_DEPTH } from '../project/autoZoom';
import { currentCut, group } from '../project/history';
import { addChapter, addLayer, deleteWords, LABELS, MAX_SPEED, MIN_SPEED, moveRange, quote, restoreWords, setCaptions, setSpeed, split, updateChapter } from '../project/ops';
import { cutLength, isKept, spans, toOut } from '../project/time';
import type { AiOp, CaptionStyle, Cut, Draft, LayoutKind, Project, Shape } from '../project/types';
import { CARD_TEMPLATES as PANEL_CARDS, capWords, cardDefaultMs, cardSlots } from '../render/layers/card';
import { chunkTranscript, echo, editSystem, editUser, REPLY_TOKENS, repairUser, transcriptBudget, type Chunk } from './prompt';

/** Why an AI request ended without a draft; each is one StatesWork state. */
export type AiErrorCode = 'not-set-up' | 'offline' | 'failed' | 'cant' | 'stopped';

export class AiError extends Error {
  constructor(readonly code: AiErrorCode, readonly detail?: string) {
    super(`Klipkord AI: ${code}`);
  }
}

/** One model call: messages in, reply text out. Callers wrap `chat` from lib/llm with keys and fetch. */
export type Call = (messages: ChatMessage[], opts: { maxTokens: number }) => Promise<string>;

/** What the validator knows: how many words there are, which the model saw, and whether cards can draw. */
export interface OpContext { words: number; from?: number; to?: number; cards: boolean; templates?: readonly string[] }

/** Card templates the AI may use: the ones the Text and cards panel offers. */
export const CARD_TEMPLATES: readonly string[] = PANEL_CARDS;
/** Labels, titles and card slot text are cut to this many characters. */
export const MAX_TEXT = 80;
/** `cant` when the request needed cards before they can draw; anything else the ops can't do is `other`. */
export type CantCode = 'cards' | 'other';

export interface Checked { ops: AiOp[]; labels: string[]; problems: string[]; cant?: CantCode }

const CAPTION_STYLES: CaptionStyle['style'][] = ['clean', 'bold', 'word'];
const LAYOUTS: LayoutKind[] = ['bubble', 'side', 'camera', 'screen'];
const SHAPES: Shape[] = ['16:9', '9:16', '1:1', '4:5'];

/** The JSON object in a reply, also when the model wrapped it in a code fence. */
export function parseReply(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    const a = body.indexOf('{');
    const b = body.lastIndexOf('}');
    if (a < 0 || b <= a) return undefined;
    try { return JSON.parse(body.slice(a, b + 1)); } catch { return undefined; }
  }
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const short = (v: string, max = MAX_TEXT) => v.trim().slice(0, max);

/**
 * Validates a reply into ops. Rejects unknown ops and word indexes, ranges back to front, overlapping cuts and an empty
 * result; `card` ops while cards cannot draw become `cant: 'cards'`; a template not in the known list is a problem.
 */
export function checkReply(raw: unknown, ctx: OpContext): Checked {
  const out: Checked = { ops: [], labels: [], problems: [] };
  const body = Array.isArray(raw) ? { ops: raw } : raw;
  if (!body || typeof body !== 'object' || !Array.isArray((body as { ops?: unknown }).ops)) {
    out.problems.push('The reply must be a JSON object with an "ops" array.');
    return out;
  }
  const lo = ctx.from ?? 0;
  const hi = ctx.to ?? ctx.words - 1;
  const word = (v: unknown, name: string, n: number) => {
    if (isInt(v) && v >= lo && v <= hi) return true;
    out.problems.push(`Op ${n}: "${name}" ${echo(v)} is not a word index from ${lo} to ${hi}.`);
    return false;
  };
  const range = (from: unknown, to: unknown, n: number) => {
    if (!word(from, 'from', n) || !word(to, 'to', n)) return false;
    if ((from as number) > (to as number)) { out.problems.push(`Op ${n}: "from" is after "to".`); return false; }
    return true;
  };
  const cuts: [number, number][] = [];
  let cards = 0;
  for (const [n, item] of ((body as { ops: unknown[] }).ops).entries()) {
    const o = (item ?? {}) as Record<string, unknown>;
    const label = isText(o.label) ? short(o.label) : '';
    let op: AiOp | null = null;
    switch (o.op) {
      case 'cut': case 'keep':
        if (range(o.from, o.to, n)) op = { op: o.op, from: o.from as number, to: o.to as number };
        if (op && o.op === 'cut') {
          const [a, b] = [o.from as number, o.to as number];
          if (cuts.some(([x, y]) => a <= y && b >= x)) { out.problems.push(`Op ${n}: cut ${a}-${b} overlaps another cut.`); op = null; }
          else cuts.push([a, b]);
        }
        break;
      case 'move':
        if (range(o.from, o.to, n) && word(o.after, 'after', n)) {
          const after = o.after as number;
          if (after >= (o.from as number) - 1 && after <= (o.to as number)) out.problems.push(`Op ${n}: "after" must be outside the moved words.`);
          else op = { op: 'move', from: o.from as number, to: o.to as number, after };
        }
        break;
      case 'speed':
        if (range(o.from, o.to, n)) {
          if (typeof o.rate === 'number' && o.rate >= MIN_SPEED && o.rate <= MAX_SPEED && o.rate !== 1) op = { op: 'speed', from: o.from as number, to: o.to as number, rate: o.rate };
          else out.problems.push(`Op ${n}: "rate" must be from ${MIN_SPEED} to ${MAX_SPEED}.`);
        }
        break;
      case 'zoom':
        if (range(o.from, o.to, n)) {
          if (typeof o.depth === 'number' && o.depth > 1) op = { op: 'zoom', from: o.from as number, to: o.to as number, depth: Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, o.depth)) };
          else out.problems.push(`Op ${n}: "depth" must be a number above 1.`);
        }
        break;
      case 'caption':
        if (CAPTION_STYLES.includes(o.style as CaptionStyle['style'])) op = { op: 'caption', style: o.style as CaptionStyle['style'] };
        else out.problems.push(`Op ${n}: "style" must be clean, bold or word.`);
        break;
      case 'card':
        if (!ctx.cards) { cards++; break; }
        if (!isText(o.template) || !(ctx.templates ?? CARD_TEMPLATES).includes(o.template)) {
          out.problems.push(`Op ${n}: "template" must be ${(ctx.templates ?? CARD_TEMPLATES).join(', ')}.`);
          break;
        }
        if (word(o.at, 'at', n)) {
          // Known templates keep only their text slots, each within its word limit.
          const defs = new Map(cardSlots(o.template).map((d) => [d.id, d.words]));
          const slots = Object.fromEntries(Object.entries((o.slots ?? {}) as Record<string, unknown>)
            .filter(([k, v]) => typeof v === 'string' && (!defs.size || defs.has(k)))
            .map(([k, v]) => [k, capWords(short(v as string), defs.get(k) ?? MAX_TEXT)]));
          const missing = cardSlots(o.template).filter((d) => !d.optional && !(slots[d.id] ?? '').trim()).map((d) => d.id);
          if (missing.length) out.problems.push(`Op ${n}: a ${o.template} card needs ${missing.map((m) => `"${m}"`).join(' and ')} text in "slots".`);
          else op = { op: 'card', template: o.template, at: o.at as number, slots };
        }
        break;
      case 'chapter':
        if (word(o.at, 'at', n)) {
          if (isText(o.title)) op = { op: 'chapter', at: o.at as number, title: short(o.title) };
          else out.problems.push(`Op ${n}: a chapter needs a "title".`);
        }
        break;
      case 'layout':
        if (word(o.at, 'at', n)) {
          if (LAYOUTS.includes(o.layout as LayoutKind)) op = { op: 'layout', at: o.at as number, layout: o.layout as LayoutKind };
          else out.problems.push(`Op ${n}: "layout" must be bubble, side, camera or screen.`);
        }
        break;
      case 'newCut': {
        const keep = Array.isArray(o.keep) ? (o.keep as Record<string, unknown>[]) : [];
        if (!isText(o.name) || !SHAPES.includes(o.shape as Shape) || !keep.length) {
          out.problems.push(`Op ${n}: a new cut needs a "name", a "shape" and "keep" ranges.`);
          break;
        }
        if (!keep.every((k) => range(k?.from, k?.to, n))) break;
        const sorted = keep.map((k) => ({ from: k.from as number, to: k.to as number })).sort((a, b) => a.from - b.from);
        if (sorted.some((k, i) => i > 0 && k.from <= sorted[i - 1]!.to)) { out.problems.push(`Op ${n}: "keep" ranges overlap.`); break; }
        op = { op: 'newCut', name: o.name.trim().slice(0, 60), shape: o.shape as Shape, keep: sorted };
        break;
      }
      default:
        out.problems.push(`Op ${n}: unknown op ${echo(o.op)}.`);
    }
    if (op) { out.ops.push(op); out.labels.push(label); }
  }
  const cant = (body as { cant?: unknown }).cant;
  if (!out.ops.length && !out.problems.length) {
    // The model's own words never reach the screen, only which fixed copy to show.
    if (cards) out.cant = 'cards';
    else if (isText(cant)) out.cant = 'other';
    else out.problems.push('The reply has no ops.');
  }
  return out;
}

/** The new ops of one more chunk; a second caption or new cut joins the first. */
function merge(into: Checked, more: Checked): void {
  for (const [i, op] of more.ops.entries()) {
    if (op.op === 'caption' && into.ops.some((x) => x.op === 'caption')) continue;
    const cut = into.ops.find((x): x is Extract<AiOp, { op: 'newCut' }> => x.op === 'newCut');
    if (op.op === 'newCut' && cut) { cut.keep.push(...op.keep); continue; }
    into.ops.push(op);
    into.labels.push(more.labels[i] ?? '');
  }
}

export interface AskArgs { request: string; project: Project; units: Unit[]; cards: boolean; call: Call; onPart?: (done: number, of: number, ops: number) => void }

/**
 * Asks for a request, one call per chunk of chapters under the 8,000-token budget. Each reply is validated and, when
 * it fails, repaired once; a second failure throws `failed`. A request the ops cannot do throws `cant`.
 */
export async function askOps({ request, project, units, cards, call, onPart }: AskArgs): Promise<Checked> {
  const system = editSystem(cards ? CARD_TEMPLATES : []);
  // The header is measured as a later part of many, its longest form.
  const header = editUser(request, project, { from: units.length, to: units.length, text: '' }, { index: 1, count: 2 });
  const chunks: Chunk[] = units.length ? chunkTranscript(project, units, transcriptBudget(system, header)) : [{ from: 0, to: -1, text: '(no transcript)' }];
  const all: Checked = { ops: [], labels: [], problems: [] };
  let cant: CantCode | undefined;
  for (const [index, chunk] of chunks.entries()) {
    const ctx: OpContext = { words: units.length, from: chunk.from, to: chunk.to, cards };
    const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: editUser(request, project, chunk, { index, count: chunks.length }) }];
    const reply = await call(messages, { maxTokens: REPLY_TOKENS });
    let checked = relaxEmpty(checkReply(parseReply(reply), ctx), chunks.length);
    if (checked.problems.length) {
      const again = await call([...messages, { role: 'assistant', content: reply }, { role: 'user', content: repairUser(checked.problems) }], { maxTokens: REPLY_TOKENS });
      checked = relaxEmpty(checkReply(parseReply(again), ctx), chunks.length);
      if (checked.problems.length) throw new AiError('failed');
    }
    cant ??= checked.cant;
    merge(all, checked);
    onPart?.(index + 1, chunks.length, all.ops.length);
  }
  if (!all.ops.length) throw cant ? new AiError('cant', cant) : new AiError('failed');
  return all;
}

/** With several chunks, one with nothing to change is fine; only the whole result must not be empty. */
function relaxEmpty(c: Checked, chunks: number): Checked {
  if (chunks > 1 && !c.ops.length && c.problems.length === 1 && c.problems[0] === 'The reply has no ops.') return { ...c, problems: [] };
  return c;
}

// ---- Applying ops: every change goes through lib/project/ops ----

const mid = (u: Unit) => (u.start + u.end) / 2;
const range = (from: number, to: number) => new Set(Array.from({ length: to - from + 1 }, (_, i) => from + i));

/** Output ms of the start of word `i`, or of its end; null when the word is cut. */
function outOf(cut: Cut, u: Unit | undefined, edge: 'start' | 'end'): number | null {
  if (!u || !isKept(cut, mid(u))) return null;
  if (edge === 'start') return toOut(cut, u.start) ?? toOut(cut, mid(u));
  const back = toOut(cut, u.end - 1);
  return back === null ? toOut(cut, mid(u)) : back + 1;
}

/** Applies one op to the current cut. Ops that no longer fit (their words are cut) change nothing. */
export function applyOp(project: Project, units: Unit[], op: AiOp): Project {
  const cut = currentCut(project);
  switch (op.op) {
    case 'cut': return deleteWords(project, { units, chosen: range(op.from, op.to) });
    case 'keep': return restoreWords(project, { units, from: op.from, to: op.to });
    case 'move': {
      const a = outOf(cut, units[op.from], 'start');
      const b = outOf(cut, units[op.to], 'end');
      const at = outOf(cut, units[op.after], 'end');
      if (a === null || b === null || at === null) return project;
      const words = units.slice(op.from, op.to + 1).map((u, i) => project.wordFixes[op.from + i] ?? u.text).join(' ');
      const next = units[op.after + 1];
      const before = next ? quote(project.wordFixes[op.after + 1] ?? next.text) : 'the end';
      return moveRange(project, { from: a, to: b, at: next ? (outOf(cut, next, 'start') ?? at) : at, label: LABELS.moveRange(words, before) });
    }
    case 'speed': {
      const a = outOf(cut, units[op.from], 'start');
      const b = outOf(cut, units[op.to], 'end');
      if (a === null || b === null || b <= a) return project;
      const parted = split(split(project, { at: a }), { at: b });
      const ids = spans(currentCut(parted)).filter((s) => s.start >= a - 1 && s.end <= b + 1 && !s.clip.gap).map((s) => s.clip.id);
      return ids.length ? setSpeed(parted, { ids, speed: op.rate }) : project;
    }
    case 'zoom': {
      const first = units[op.from]!;
      const last = units[op.to]!;
      return addLayer(project, { kind: 'zooms', items: [{ at: first.start, end: Math.max(last.end, first.start + 800), depth: op.depth, focus: 'cursor', feel: 'smooth', auto: false }] });
    }
    case 'caption': return setCaptions(project, { patch: { style: op.style, show: true } });
    case 'card': return addLayer(project, { kind: 'cards', items: [{ template: op.template, at: units[op.at]!.start, ms: cardDefaultMs(op.template), slots: op.slots, pack: 'clean' }] });
    case 'chapter': {
      const u = units[op.at]!;
      const index = project.chapters.findIndex((c) => c.at >= u.start - 1 && c.at <= u.end);
      return index >= 0
        ? updateChapter(project, { index, patch: { title: op.title } })
        : addChapter(project, { chapter: { at: u.start, title: op.title } });
    }
    case 'layout': return addLayer(project, { kind: 'layouts', items: [{ at: units[op.at]!.start, layout: op.layout, switch: 'smooth' }] });
    case 'newCut': return project;   // lib/ai/highlight.ts makes new cuts: they change which cut is current
  }
}

/** Output ms where an op lands in the current cut, for its row. */
export function opAt(project: Project, units: Unit[], op: AiOp): number {
  const cut = currentCut(project);
  const i = 'from' in op ? op.from : 'at' in op ? op.at : -1;
  const u = units[i];
  return u ? (toOut(cut, u.start) ?? toOut(cut, mid(u)) ?? 0) : 0;
}

/** The ops of a draft that are ticked. */
export const ticked = (draft: Draft): AiOp[] => draft.ops.filter((_, i) => draft.changes[i]?.on !== false);

const applyAll = (project: Project, units: Unit[], ops: AiOp[]) => ops.reduce((p, op) => applyOp(p, units, op), project);

/** A model reply as a draft: one row per op, all ticked, and the cut's length before and after. */
export function toDraft(project: Project, units: Unit[], request: string, checked: Pick<Checked, 'ops' | 'labels'>): Draft {
  const ops = checked.ops.filter((o) => o.op !== 'newCut');
  const labels = checked.labels.filter((_, i) => checked.ops[i]!.op !== 'newCut');
  const draft: Draft = {
    request, ops,
    changes: ops.map((op, i) => ({ label: labels[i] || opLabel(project, units, op), at: opAt(project, units, op), on: true })),
    before: cutLength(currentCut(project)), after: 0,
  };
  return withLengths(project, units, draft);
}

/** Recomputes `after` once rows are ticked or unticked. */
export function withLengths(project: Project, units: Unit[], draft: Draft): Draft {
  return { ...draft, before: cutLength(currentCut(project)), after: cutLength(currentCut(applyAll(project, units, ticked(draft)))) };
}

/** Ticks or unticks row `i`. */
export function toggleChange(project: Project, units: Unit[], draft: Draft, i: number): Draft {
  return withLengths(project, units, { ...draft, changes: draft.changes.map((c, k) => (k === i ? { ...c, on: !c.on } : c)) });
}

/** How much one op changes the cut's length, ms (negative is shorter). */
export function opDelta(project: Project, units: Unit[], op: AiOp): number {
  return cutLength(currentCut(applyOp(project, units, op))) - cutLength(currentCut(project));
}

/** "Apply N": the ticked ops as one Undo step. */
export function applyDraft(project: Project, units: Unit[], draft: Draft): Project {
  const ops = ticked(draft);
  if (!ops.length) return project;
  return group(project, LABELS.aiDraft(ops.length), (p) => applyAll(p, units, ops));
}

/** The draft shown in orange: words the ticked ops would cut, by unit index. */
export function draftWords(project: Project, units: Unit[], draft: Draft): Set<number> {
  const before = currentCut(project);
  const after = currentCut(applyAll(project, units, ticked(draft)));
  const out = new Set<number>();
  units.forEach((u, i) => { if (isKept(before, mid(u)) && !isKept(after, mid(u))) out.add(i); });
  return out;
}

/**
 * The draft on the timeline, in output ms of the current cut: the ranges its ticked ops would cut, merged, and where
 * each other ticked change lands.
 */
export function draftSpans(project: Project, units: Unit[], draft: Draft): { cuts: { start: number; end: number }[]; at: number[] } {
  const cut = currentCut(project);
  const cuts: { start: number; end: number }[] = [];
  for (const i of [...draftWords(project, units, draft)].sort((a, b) => a - b)) {
    const start = outOf(cut, units[i], 'start');
    const end = outOf(cut, units[i], 'end');
    if (start === null || end === null) continue;
    const last = cuts.at(-1);
    // Words a pause apart read as one orange stretch.
    if (last && start - last.end < 400) last.end = Math.max(last.end, end);
    else cuts.push({ start, end });
  }
  const at = draft.ops.flatMap((op, i) => (draft.changes[i]?.on === false || op.op === 'cut' ? [] : [draft.changes[i]?.at ?? opAt(project, units, op)]));
  return { cuts, at };
}

/** A row label when the model gave none, in the words of the undo labels. */
export function opLabel(project: Project, units: Unit[], op: AiOp): string {
  const words = (from: number, to: number) => units.slice(from, to + 1).map((u, i) => project.wordFixes[from + i] ?? u.text).join(' ');
  switch (op.op) {
    case 'cut': return `Cut ${quote(words(op.from, op.to))}`;
    case 'keep': return `Brought back ${quote(words(op.from, op.to))}`;
    case 'move': return LABELS.moveRange(words(op.from, op.to), quote(words(op.after + 1, op.after + 1)));
    case 'speed': return LABELS.setSpeed(op.rate);
    case 'zoom': return LABELS.added(1, ['zoom', 'zooms']);
    case 'caption': return LABELS.captions;
    case 'card': return LABELS.added(1, [op.template.replace(/[-_]+/g, ' '), '']);
    case 'chapter': return LABELS.chapter('Added', op.title);
    case 'layout': return LABELS.switched(op.layout, opAt(project, units, op));
    case 'newCut': return LABELS.highlight(op.name);
  }
}
