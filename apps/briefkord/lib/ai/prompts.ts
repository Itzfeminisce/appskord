/**
 * The prompt for each AI action. Each one carries only what its surface says is sent:
 * Summarize: the link's title and saved page text. Diagram: the description (and, for a change, the open diagram).
 * Suggest an order: card titles, types and notes. Brief me: card titles, notes and the text of saved pages.
 * Fill a field: that one card's own text (see `cardText`). Never images, files or addresses.
 */
import { estimateTokens, type ChatMessage } from '@appskord/llm';
import { listOrder } from '../board/ops';
import type { Board, Card, Diagram, LinkCard } from '../board/types';

/** The most a prompt may use, in estimated tokens. */
export const PROMPT_BUDGET = 8000;
const CHARS_PER_TOKEN = 4;

export interface Prompt { messages: ChatMessage[]; maxTokens: number }

/** "Your notes" on a card: what to say about it, and a note card's own text. */
export function notesOf(card: Card): string {
  const parts = [card.say.trim(), card.kind === 'note' ? card.text.trim() : ''].filter(Boolean);
  return parts.join('\n');
}

/** Shortens texts so their total length is at most `budget` characters, cutting the longest first. */
export function fitTexts(texts: readonly string[], budget: number): string[] {
  const total = texts.reduce((n, t) => n + t.length, 0);
  if (total <= budget) return [...texts];
  const sorted = texts.map((t) => t.length).sort((a, b) => a - b);
  let left = Math.max(0, budget);
  let cap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const share = Math.floor(left / (sorted.length - i));
    if (sorted[i]! <= share) left -= sorted[i]!;
    else {
      cap = share;
      break;
    }
  }
  return texts.map((t) => (t.length > cap ? t.slice(0, cap) : t));
}

/** Builds the messages with `long` texts shortened until the whole prompt fits the budget. */
function fitted(system: string, user: (long: string[]) => string, long: readonly string[]): ChatMessage[] {
  const build = (texts: string[]): ChatMessage[] => [
    { role: 'system', content: system },
    { role: 'user', content: user(texts) },
  ];
  const fixed = estimateTokens(build(long.map(() => '')));
  // A tenth spare for the escapes JSON adds.
  const room = Math.floor((PROMPT_BUDGET - fixed) * CHARS_PER_TOKEN * 0.9);
  return build(fitTexts(long, room));
}

const JSON_ONLY = 'Reply with one JSON object only, no prose and no code fence.';

export function summaryPrompt(link: Pick<LinkCard, 'title' | 'text'>): Prompt {
  const system = [
    'You summarize a saved web page for a meeting board.',
    JSON_ONLY,
    'Shape: {"title": string, "summary": string}.',
    '"title": 2 to 4 words naming what the page is about.',
    '"summary": 2 to 5 short plain sentences. The first says the main point; each other one adds one finding.',
    'Use only the page text given. Do not invent numbers.',
  ].join('\n');
  const messages = fitted(system, ([text]) => JSON.stringify({ title: link.title, text }), [link.text]);
  return { messages, maxTokens: 700 };
}

const DIAGRAM_SHAPE = [
  JSON_ONLY,
  'Shape: {"nodes": [{"id": string, "kind": "step"|"choice"|"end"|"text", "label": string}], "edges": [{"from": node id, "to": node id, "label"?: string}]}.',
  '"end" is where the flow starts or finishes. "choice" is a question with two or more labelled edges out (such as "Yes" and "No").',
  'Labels are short: at most 4 words. Every step connects to the flow. Give no positions or sizes.',
].join('\n');

/** `current`: the open diagram, for "Describe a change". */
export function diagramPrompt(description: string, current?: Diagram): Prompt {
  const system = ['You turn a description of a process into a flow diagram.', DIAGRAM_SHAPE].join('\n');
  const now = current && {
    nodes: current.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
    edges: current.edges.map((e) => ({ from: e.from, to: e.to, ...(e.label ? { label: e.label } : {}) })),
  };
  const messages = fitted(
    system,
    ([text]) => (now ? `Current diagram:\n${JSON.stringify(now)}\n\nChange to make, then reply with the whole new diagram:\n${text}` : `Description:\n${text}`),
    [description],
  );
  return { messages, maxTokens: 2000 };
}

export function orderPrompt(board: Board): Prompt & { cardIds: string[] } {
  const cardIds = listOrder(board).filter((id) => board.cards[id]);
  const cards = cardIds.map((id) => board.cards[id]!);
  const system = [
    'You suggest the order to walk through the cards of a meeting board, so the story is easy to follow.',
    JSON_ONLY,
    'Shape: {"headline": string, "order": [card id], "reasons": [{"card": card id, "why": string}]}.',
    '"headline" is a few words naming the flow, for example "problem, evidence, fix, then decisions".',
    '"order" names every card id exactly once.',
    '"reasons": one for each card you moved, at most 4. "why" is a short headline sentence, then one sentence of reason.',
  ].join('\n');
  const messages = fitted(
    system,
    (notes) => `Cards in the current order:\n${JSON.stringify(cards.map((c, i) => ({ id: c.id, type: c.kind, title: c.title, notes: notes[i] })))}`,
    cards.map(notesOf),
  );
  return { messages, maxTokens: 2000, cardIds };
}

export function briefPrompt(board: Board): Prompt & { cardIds: string[]; pages: number } {
  const cardIds = listOrder(board).filter((id) => board.cards[id]);
  const cards = cardIds.map((id) => board.cards[id]!);
  const pageOf = (c: Card) => (c.kind === 'link' ? c.text.trim() : '');
  const pages = cards.filter((c) => pageOf(c)).length;
  const system = [
    'You brief someone before a meeting about the cards on their board.',
    JSON_ONLY,
    'Shape: {"points": [{"text": string, "cards": [card number]}], "questions": [string], "missing": [string]}.',
    '"points": 2 to 5 talking points, one sentence each, with the numbers of the cards each one is about.',
    '"questions": open questions the cards raise but do not answer. "missing": things the topic needs that no card covers.',
    'Use only what the cards say.',
  ].join('\n');
  const long = [...cards.map(notesOf), ...cards.map(pageOf)];
  const messages = fitted(
    system,
    (texts) =>
      `Cards:\n${JSON.stringify(
        cards.map((c, i) => {
          const notes = texts[i]!;
          const page = texts[cards.length + i]!;
          return { number: i + 1, title: c.title, ...(notes ? { notes } : {}), ...(page ? { pageText: page } : {}) };
        }),
      )}`,
    long,
  );
  return { messages, maxTokens: 2000, cardIds, pages };
}

/** A Details field the sparkle fills, and what it does: write an empty field, or rework the text in it. */
export type FillField = 'title' | 'say';
export type FillMode = 'write' | 'shorter' | 'clearer' | 'spelling';

/** One card's own text: its title, what to say, note text, saved page text, checklist items, diagram labels. */
export function cardText(card: Card): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (name: string, value: string | undefined) => {
    const v = value?.trim();
    if (v) out[name] = v;
  };
  put('title', card.title);
  put('say', card.say);
  if (card.kind === 'note') put('noteText', card.text);
  if (card.kind === 'link') put('pageText', card.text);
  if (card.kind === 'checklist') put('checklist', card.items.map((i) => i.text.trim()).filter(Boolean).join('\n'));
  if (card.kind === 'diagram') put('diagramLabels', [...card.diagram.nodes.map((n) => n.label), ...card.diagram.edges.map((e) => e.label ?? '')].map((l) => l.trim()).filter(Boolean).join('\n'));
  return out;
}

/** True when the card has no text to work from (an image or file with nothing typed). */
export const hasNoText = (card: Card): boolean => Object.keys(cardText(card)).length === 0;

const FIELD_ASK: Record<FillField, string> = {
  title: 'the card\'s title: 2 to 7 words, no ending full stop',
  say: '"what to say about it": what the presenter says when they reach this card in the meeting, 1 to 3 short plain sentences',
};
const MODE_ASK: Record<Exclude<FillMode, 'write'>, string> = {
  shorter: 'Make the current text shorter. Keep its meaning and its facts.',
  clearer: 'Make the current text clearer and easier to say out loud. Keep its meaning and its facts.',
  spelling: 'Fix only the spelling, grammar and capitals of the current text. Change nothing else.',
};

/** The prompt for one sparkle: fills `field` from `card`'s own text only. `current` is what the field holds now. */
export function fillPrompt(card: Card, field: FillField, mode: FillMode, current: string): Prompt {
  const system = [
    `You write ${FIELD_ASK[field]}, for one card on a meeting board.`,
    JSON_ONLY,
    'Shape: {"text": string}.',
    mode === 'write' ? 'Write it from the card text given.' : MODE_ASK[mode],
    'Use only what the card says. Do not invent facts or numbers.',
  ].join('\n');
  const own = cardText(card);
  delete own[field];
  const names = Object.keys(own);
  const messages = fitted(
    system,
    (texts) => {
      const fields = Object.fromEntries(names.map((n, i) => [n, texts[i]!]));
      const cardJson = JSON.stringify({ type: card.kind, ...fields });
      return mode === 'write' ? `Card:\n${cardJson}` : `Card:\n${cardJson}\n\nCurrent text:\n${current.trim()}`;
    },
    names.map((n) => own[n]!),
  );
  return { messages, maxTokens: field === 'title' ? 200 : 600 };
}
