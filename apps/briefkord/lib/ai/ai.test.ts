import { describe, expect, it, vi } from 'vitest';
import { estimateTokens } from '@appskord/llm';
import { listOrder, updateCard } from '../board/ops';
import { sampleBoard } from '../board/sample';
import type { Board, LinkCard } from '../board/types';
import { addBriefNote, addSummary, briefPointsFor, briefText, diagramCounts, diagramFromReply, keptBrief, movedCount, orderMoves, summaryHeight, summaryNote, summarySentences, withBrief } from './apply';
import { parseBrief, parseDiagram, parseFill, parseOrder, parseSummary } from './parse';
import { briefPrompt, cardText, diagramPrompt, fillPrompt, fitTexts, hasNoText, orderPrompt, PROMPT_BUDGET, summaryPrompt } from './prompts';
import { AiError, askAi } from './run';

const NOW = 1_762_000_000_000;
const KEY = 'sk-test';

/** The sample board with page text on the findings link and a private checklist and file name. */
function board(): Board {
  const b = sampleBoard(NOW);
  return updateCard(b, 'findings', NOW, (c) => (c.kind === 'link' ? { ...c, text: 'PAGE-TEXT coupon field and late card errors.', words: 7 } : c));
}

const sent = (messages: { content: string }[]) => messages.map((m) => m.content).join('\n');

describe('parse', () => {
  it('reads a good summary, also inside prose', () => {
    expect(parseSummary('Here: {"title":"Checkout usability","summary":"One. Two."} done')).toEqual({ ok: true, value: { title: 'Checkout usability', summary: 'One. Two.' } });
  });
  it('refuses a bad or partial summary', () => {
    expect(parseSummary('not json').ok).toBe(false);
    expect(parseSummary('{"title":"x"}').ok).toBe(false);
    expect(parseSummary('{"title":" ","summary":"One."}').ok).toBe(false);
  });

  it('reads a good diagram', () => {
    const r = parseDiagram(JSON.stringify({
      nodes: [{ id: 'a', kind: 'end', label: 'Cart' }, { id: 'b', kind: 'choice', label: 'Card saved?' }, { id: 'c', kind: 'step', label: 'Pay' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', label: 'Yes' }],
    }));
    expect(r.ok && r.value.nodes.length).toBe(3);
    expect(r.ok && r.value.edges[1]).toEqual({ from: 'b', to: 'c', label: 'Yes' });
  });
  it('refuses a diagram whose steps do not connect, or name missing nodes, or use unknown kinds', () => {
    const nodes = [{ id: 'a', kind: 'step', label: 'A' }, { id: 'b', kind: 'step', label: 'B' }];
    expect(parseDiagram(JSON.stringify({ nodes, edges: [] })).ok).toBe(false);
    expect(parseDiagram(JSON.stringify({ nodes, edges: [{ from: 'a', to: 'z' }] })).ok).toBe(false);
    expect(parseDiagram(JSON.stringify({ nodes: [{ id: 'a', kind: 'box', label: 'A' }], edges: [] })).ok).toBe(false);
    expect(parseDiagram('{"nodes":[]}').ok).toBe(false);
  });

  it('reads an order that names every card once, keeping only usable reasons', () => {
    const r = parseOrder(JSON.stringify({ headline: 'problem, then fix', order: ['b', 'a', 'c'], reasons: [{ card: 'b', why: 'First.' }, { card: 'zz', why: 'x' }, { why: 'no card' }] }), ['a', 'b', 'c']);
    expect(r).toEqual({ ok: true, value: { headline: 'problem, then fix', order: ['b', 'a', 'c'], reasons: [{ card: 'b', why: 'First.' }] } });
    expect(parseOrder('{"order":["a"]}', ['a'])).toEqual({ ok: true, value: { headline: '', order: ['a'], reasons: [] } });
  });
  it('refuses an order that leaves out, repeats or invents a card', () => {
    const ids = ['a', 'b', 'c'];
    expect(parseOrder('{"order":["a","b"]}', ids).ok).toBe(false);
    expect(parseOrder('{"order":["a","b","b"]}', ids).ok).toBe(false);
    expect(parseOrder('{"order":["a","b","c","d"]}', ids).ok).toBe(false);
    expect(parseOrder('{"reasons":[]}', ids).ok).toBe(false);
  });

  it('reads a brief, dropping card numbers that were not sent and filling missing lists', () => {
    const r = parseBrief(JSON.stringify({ points: [{ text: 'Payment loses 38%.', cards: [1, 3, 9, 3, 'x'] }, { text: '' }] }), 7);
    expect(r).toEqual({ ok: true, value: { points: [{ text: 'Payment loses 38%.', cards: [1, 3] }], questions: [], missing: [] } });
  });
  it('refuses a brief with no usable points', () => {
    expect(parseBrief('{"points":[]}', 3).ok).toBe(false);
    expect(parseBrief('{"questions":["Why?"]}', 3).ok).toBe(false);
    expect(parseBrief('oops', 3).ok).toBe(false);
  });
});

describe('prompts send only what the surface says', () => {
  it('Summarize: the link title and page text, nothing else', () => {
    const b = board();
    const link = b.cards.findings as LinkCard;
    const text = sent(summaryPrompt(link).messages);
    expect(text).toContain('PAGE-TEXT');
    expect(text).toContain(link.title);
    expect(text).not.toContain('baymard.com');
    expect(text).not.toContain('Why now');
    expect(text).not.toContain('Findings 4 and 11');
  });

  it('Diagram: the description, and the open diagram only for a change', () => {
    const b = board();
    const first = sent(diagramPrompt('People add items to the cart').messages);
    expect(first).toContain('People add items to the cart');
    expect(first).not.toContain('Checkout flow today');
    const flow = b.cards.flow;
    const change = sent(diagramPrompt('Add a review step', flow?.kind === 'diagram' ? flow.diagram : undefined).messages);
    expect(change).toContain('Add a review step');
    expect(change).toContain('Payment');
    expect(change).not.toContain('Walk left to right');
  });

  it('Suggest an order: titles, types and notes; no page text, files or checklist items', () => {
    const b = board();
    const p = orderPrompt(b);
    const text = sent(p.messages);
    expect(p.cardIds).toEqual(listOrder(b));
    expect(text).toContain('Checkout flow today');
    expect(text).toContain('"type":"diagram"');
    expect(text).toContain('Walk left to right');
    expect(text).not.toContain('PAGE-TEXT');
    expect(text).not.toContain('Legal ok on saved cards');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('Current checkout, step 2.png');
  });

  it('Brief me: titles, notes and saved page text; no addresses, files, checklist items or diagram steps', () => {
    const b = board();
    const p = briefPrompt(b);
    const text = sent(p.messages);
    expect(p.pages).toBe(1);
    expect(text).toContain('PAGE-TEXT');
    expect(text).toContain('Drop-off at payment is 38%');
    expect(text).toContain('Findings 4 and 11');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('Legal ok on saved cards');
    expect(text).not.toContain('Current checkout, step 2.png');
    expect(text).not.toContain('Card saved?');
  });

  it('keeps every prompt under the token budget by cutting long page text', () => {
    const long = 'word '.repeat(40_000);
    const b = updateCard(board(), 'findings', NOW, (c) => (c.kind === 'link' ? { ...c, text: long } : c));
    expect(estimateTokens(briefPrompt(b).messages)).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(estimateTokens(summaryPrompt({ title: 'T', text: long }).messages)).toBeLessThanOrEqual(PROMPT_BUDGET);
    expect(fitTexts(['aaaa', 'bbbbbbbbbb', 'cc'], 10)).toEqual(['aaaa', 'bbbb', 'cc']);
  });
});

describe('askAi', () => {
  const okReply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
  const prompt = summaryPrompt({ title: 'T', text: 'Some page text.' });

  it('asks once more after a reply that does not fit, then succeeds', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(okReply('{"title":"x"}')).mockResolvedValueOnce(okReply('{"title":"T","summary":"A. B."}'));
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', key: KEY, fetch })).resolves.toEqual({ title: 'T', summary: 'A. B.' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up with ai-bad-reply after one retry', async () => {
    const fetch = vi.fn(async () => okReply('nope'));
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', key: KEY, fetch })).rejects.toMatchObject({ state: 'ai-bad-reply' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('maps a refused key, no key and no answer to their states', async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }));
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', key: KEY, fetch: refused })).rejects.toMatchObject({ state: 'ai-key-refused' });
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', fetch: refused })).rejects.toMatchObject({ state: 'ai-no-key' });
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', key: KEY, fetch: down })).rejects.toBeInstanceOf(AiError);
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', key: KEY, fetch: down })).rejects.toMatchObject({ state: 'ai-unreachable' });
  });

  it('Stop cancels', async () => {
    const stop = new AbortController();
    const fetch = vi.fn(async () => {
      stop.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(askAi(prompt, parseSummary, { provider: 'openai', model: 'm', key: KEY, fetch, signal: stop.signal })).rejects.toMatchObject({ state: 'cancelled' });
  });
});

describe('apply', () => {
  const meta = { model: 'model-x', provider: 'openai' };

  it('makes the summary card tall enough for the frame summary, every point and the footer', () => {
    const text = 'Most people who leave checkout do it for reasons the page could fix. A visible coupon field sends people off to search for codes. Card errors that appear only after Pay make people start again. Shipping costs shown on the last step feel like a surprise. Guest checkout hidden behind sign-in loses first-time buyers.';
    expect(summarySentences(text)).toHaveLength(5);
    const h = summaryHeight(text, 'From the page text saved 3 Nov'.length);
    // The frame card is 340 tall for this text at 380 wide.
    expect(h).toBeGreaterThanOrEqual(310);
    expect(h).toBeLessThan(440);
    expect(summaryHeight('One line.', 'From the page text saved 3 Nov'.length)).toBeLessThan(160);
  });

  it('puts a summary next to its link, after it in the list, joined by a dashed arrow', () => {
    const b = board();
    const link = b.cards.findings as LinkCard;
    const note = summaryNote(link, { title: 'Checkout usability', summary: 'A. B.' }, meta, 'sum', NOW);
    const next = addSummary(b, 'findings', note, 'arrow', NOW);
    const order = listOrder(next);
    expect(order[order.indexOf('findings') + 1]).toBe('sum');
    expect(next.arrows.find((a) => a.id === 'arrow')).toEqual({ id: 'arrow', from: 'findings', to: 'sum', dashed: true });
    const placed = next.cards.sum!;
    // To the right of the link, top-aligned, past the cards already on that row.
    expect(placed.rect.y).toBe(link.rect.y);
    expect(placed.rect.x).toBeGreaterThan(link.rect.x + link.rect.w);
    expect(placed.kind === 'note' && placed.summary).toEqual({ of: 'findings', model: 'model-x', provider: 'openai', from: link.savedAt });
    for (const c of Object.values(b.cards)) {
      const r = placed.rect;
      expect(r.x < c.rect.x + c.rect.w && c.rect.x < r.x + r.w && r.y < c.rect.y + c.rect.h && c.rect.y < r.y + r.h).toBe(false);
    }
  });

  it('lays out an AI diagram and counts its steps', () => {
    const d = diagramFromReply({ nodes: [{ id: 'a', kind: 'end', label: 'Cart' }, { id: 'b', kind: 'choice', label: 'Saved?' }, { id: 'c', kind: 'step', label: 'Pay' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] });
    expect(d.nodes.every((n) => n.w > 0 && n.h > 0)).toBe(true);
    expect(new Set(d.nodes.map((n) => n.x)).size).toBe(3);
    expect(diagramCounts(d)).toEqual({ steps: 2, choices: 1 });
  });

  it('marks the fewest cards as moved', () => {
    const moves = orderMoves(['1', '2', '3', '4', '5'], ['1', '3', '2', '4', '5']);
    expect(movedCount(moves)).toBe(1);
    expect(moves[0]!.move).toEqual({ kind: 'stays' });
    const kinds = moves.map((m) => m.move.kind);
    expect(kinds.filter((k) => k === 'up' || k === 'down')).toHaveLength(1);
    expect(orderMoves(['a', 'b', 'c'], ['c', 'a', 'b']).map((m) => m.move)).toEqual([{ kind: 'up', from: 3 }, { kind: 'near', from: 1 }, { kind: 'near', from: 2 }]);
  });

  it('counts and labels moves as the SuggestOrder frame does', () => {
    const was = ['why', 'findings', 'flow', 'step-2', 'report', 'new', 'ship'];
    const moves = orderMoves(was, ['why', 'flow', 'report', 'findings', 'step-2', 'new', 'ship']);
    expect(movedCount(moves)).toBe(3);
    expect(moves.map((m) => m.move)).toEqual([
      { kind: 'stays' }, { kind: 'up', from: 3 }, { kind: 'up', from: 5 }, { kind: 'down', from: 2 }, { kind: 'near', from: 4 }, { kind: 'stays' }, { kind: 'stays' },
    ]);
    expect(movedCount(orderMoves(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a']))).toBe(1);
    expect(movedCount(orderMoves(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']))).toBe(0);
  });

  it('keeps Brief me points by card id and finds them per card', () => {
    const b = board();
    const p = briefPrompt(b);
    const kept = keptBrief({ points: [{ text: 'Payment loses 38%.', cards: [1, 3] }], questions: ['Who owns errors?'], missing: ['Mobile'] }, p.cardIds, meta, NOW);
    expect(kept.points[0]!.cards).toEqual([p.cardIds[0], p.cardIds[2]]);
    const next = withBrief(b, kept, NOW);
    expect(briefPointsFor(next, p.cardIds[2]!)).toEqual(['Payment loses 38%.']);
    expect(briefPointsFor(next, p.cardIds[1]!)).toEqual([]);
    const text = briefText(next, kept, ['Mobile']);
    expect(text).toContain('1. Payment loses 38%. (1, 3)');
    expect(text).toContain('Open questions\n- Who owns errors?');
    expect(text).toContain('Not on the board yet\n- Mobile');
    const withNote = addBriefNote(next, text, 'n', NOW);
    expect(withNote.cards.n?.kind === 'note' && withNote.cards.n.title).toBe('Brief me');
  });
});

describe('fill a field', () => {
  const card = (id: string) => board().cards[id]!;

  it('sends only that card’s own text', () => {
    const b = board();
    const text = sent(fillPrompt(b.cards.findings!, 'say', 'write', '').messages);
    expect(text).toContain('PAGE-TEXT');
    expect(text).toContain('Checkout usability: 18 findings');
    expect(text).not.toContain('Before we ship');
    expect(text).not.toContain('Why now');
    expect(sent(fillPrompt(card('before-ship'), 'title', 'write', '').messages)).toContain('A/B test plan signed off');
    expect(sent(fillPrompt(card('flow'), 'say', 'write', '').messages)).toContain('Card saved?');
  });

  it('leaves the field it fills out of the card text, and sends the current text to rework', () => {
    const c = { ...card('findings'), say: 'OLD-SAY there cart' };
    const write = sent(fillPrompt(c, 'title', 'write', '').messages);
    expect(write).not.toContain('Checkout usability: 18 findings');
    expect(write).toContain('OLD-SAY');
    const fix = fillPrompt(c, 'say', 'spelling', 'OLD-SAY there cart').messages;
    expect(fix[0]!.content).toContain('spelling');
    expect(fix[1]!.content.match(/OLD-SAY/g)).toHaveLength(1);
    expect(fix[1]!.content).toContain('Current text:');
  });

  it('knows a card with no text to work from', () => {
    const image = card('step-2');
    expect(hasNoText({ ...image, title: '', say: '' })).toBe(true);
    expect(hasNoText(image)).toBe(false);
    expect(cardText({ ...image, title: ' ', say: '' })).toEqual({});
  });

  it('never sends a link address', () => {
    const c = card('findings') as LinkCard;
    const sent = fillPrompt(c, 'say', 'write', '').messages.map((m) => m.content).join('\n');
    expect(sent).not.toContain(c.url);
  });

  it('keeps a long page within the budget', () => {
    const c = { ...(card('findings') as LinkCard), text: 'word '.repeat(60_000) };
    expect(estimateTokens(fillPrompt(c, 'say', 'write', '').messages)).toBeLessThanOrEqual(PROMPT_BUDGET);
  });

  it('reads a reply, on one line for a title', () => {
    expect(parseFill(JSON.stringify({ text: 'Two findings\nmatch support' }), 'say')).toEqual({ ok: true, value: 'Two findings\nmatch support' });
    expect(parseFill(`Sure: ${JSON.stringify({ text: ' "18 checkout findings\n from tests" ' })}`, 'title')).toEqual({ ok: true, value: '18 checkout findings from tests' });
    expect(parseFill('{"text":"  "}', 'say').ok).toBe(false);
    expect(parseFill('no json', 'title').ok).toBe(false);
  });

  it('asks once more after a bad reply', async () => {
    const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
    const fetch = vi.fn().mockResolvedValueOnce(reply('nope')).mockResolvedValueOnce(reply('{"text":"Better title"}'));
    const value = await askAi(fillPrompt(card('why-now'), 'title', 'clearer', 'why now'), (r) => parseFill(r, 'title'), { provider: 'openai', model: 'm', key: KEY, fetch });
    expect(value).toBe('Better title');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
