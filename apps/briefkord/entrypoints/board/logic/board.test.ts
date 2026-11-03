import { describe, expect, it } from 'vitest';
import { sampleBoard } from '@/lib/board/sample';
import { validateBoard } from '@/lib/board/validate';
import { routeEdge } from '../cards/DiagramView';
import { duplicateCard, lastEdit, newFileCard, webUrl, withNewFiles } from './cards';
import { regroup } from './groups';
import { repairBoard } from './repair';

const T = Date.UTC(2026, 10, 3, 9, 12);

describe('repairBoard', () => {
  it('keeps every readable card in a valid copy with a new id', () => {
    const raw = JSON.parse(JSON.stringify(sampleBoard(T))) as Record<string, any>;
    raw.cards['why-now'].rect.x = null;
    raw.sections[0].cards.push('ghost');
    expect(validateBoard(raw).ok).toBe(false);
    const copy = repairBoard(raw, 'copy', T)!;
    expect(validateBoard(copy).ok).toBe(true);
    expect(copy.id).toBe('copy');
    expect(Object.keys(copy.cards)).toHaveLength(6);
    expect(copy.sections.flatMap((s) => s.cards)).not.toContain('ghost');
    expect(copy.name).toBe('Checkout redesign review');
  });

  it('places cards that were in no section at the end', () => {
    const raw = JSON.parse(JSON.stringify(sampleBoard(T))) as Record<string, any>;
    raw.sections = [{ id: 'only', title: 'Only', minutes: 0, cards: ['flow'] }];
    const copy = repairBoard(raw, 'copy', T)!;
    expect(copy.sections[0]!.cards).toHaveLength(7);
    expect(copy.sections[0]!.cards[0]).toBe('flow');
  });

  it('keeps a diagram whose nodes link to other cards, and its links', () => {
    const raw = JSON.parse(JSON.stringify(sampleBoard(T))) as Record<string, any>;
    raw.cards.flow.diagram.nodes[0].card = 'report';
    raw.cards.flow.diagram.nodes[1].card = 'ghost';
    raw.cards['why-now'].rect.x = null;
    const copy = repairBoard(raw, 'copy', T)!;
    expect(copy.cards.flow).toBeDefined();
    const nodes = (copy.cards.flow as any).diagram.nodes;
    expect(nodes[0].card).toBe('report');
    expect(nodes[1].card).toBeUndefined();
    expect(validateBoard(copy).ok).toBe(true);
  });

  it('gives up when nothing can be read', () => {
    expect(repairBoard({ cards: { x: { id: 'x' } } }, 'copy', T)).toBeUndefined();
    expect(repairBoard('nonsense', 'copy', T)).toBeUndefined();
  });
});

describe('regroup', () => {
  it('takes a card dragged clear of its group out of it', () => {
    const b = sampleBoard(T);
    const grouped = { ...b, groups: [{ id: 'g', title: 'G', cards: ['why-now', 'before-ship'] }] };
    const moved = { ...grouped, cards: { ...grouped.cards, 'before-ship': { ...grouped.cards['before-ship']!, rect: { x: 3000, y: 3000, w: 220, h: 176 } } } };
    expect(regroup(moved, ['before-ship'], T).groups).toEqual([{ id: 'g', title: 'G', cards: ['why-now'] }]);
  });

  it('adds a loose card dropped inside a group', () => {
    const b = sampleBoard(T);
    const flow = b.cards['flow']!.rect;
    const moved = { ...b, cards: { ...b.cards, report: { ...b.cards['report']!, rect: { ...b.cards['report']!.rect, x: flow.x + 10, y: flow.y + 10 } } } };
    expect(regroup(moved, ['report'], T).groups[0]!.cards).toEqual(['flow', 'report']);
  });

  it('leaves a whole group moving together alone', () => {
    const b = sampleBoard(T);
    expect(regroup(b, ['flow'], T)).toBe(b);
  });
});

describe('cards', () => {
  it('sizes an image card to its picture and names it without the extension', () => {
    const card = newFileCard('c', { x: 0, y: 0 }, { id: 'f', name: 'Step 2.png', mime: 'image/png', size: 10 }, T, { w: 1440, h: 900 });
    expect(card.kind).toBe('image');
    expect(card.title).toBe('Step 2');
    expect(card.rect.h).toBe(Math.round((264 * 900) / 1440) + 48);
    expect(newFileCard('d', { x: 0, y: 0 }, { id: 'g', name: 'Q3.pdf', mime: 'application/pdf', size: 10 }, T).kind).toBe('file');
  });

  it('duplicates with a new id, offset, and no import mark', () => {
    const card = { ...sampleBoard(T).cards['why-now']!, mark: 'added' as const };
    const copy = duplicateCard(card, 'copy', T + 1);
    expect(copy).toMatchObject({ id: 'copy', rect: { x: card.rect.x + 24, y: card.rect.y + 24 }, createdAt: T + 1 });
    expect(copy.mark).toBeUndefined();
  });

  it('gives a copied file card its own file id', () => {
    const card = sampleBoard(T).cards['step-2']!;
    const { card: copy, copies } = withNewFiles(duplicateCard(card, 'copy', T + 1), () => 'new-file');
    expect((copy as any).file).toMatchObject({ id: 'new-file', name: (card as any).file.name });
    expect(copies).toEqual([{ from: (card as any).file, to: 'new-file' }]);
    expect(withNewFiles(sampleBoard(T).cards['why-now']!, () => 'x').copies).toEqual([]);
  });

  it('opens only web addresses', () => {
    expect(webUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(webUrl('chrome://settings')).toBeUndefined();
    expect(webUrl('file:///etc/passwd')).toBeUndefined();
  });

  it('writes the last edit as the boards list does', () => {
    expect(lastEdit(T - 12 * 60_000, T)).toBe('12 min ago');
    expect(lastEdit(T - 3 * 86_400_000, T)).toBe('31 Oct');
  });
});

describe('routeEdge', () => {
  it('runs straight, then sideways and down, as the sample diagram draws', () => {
    expect(routeEdge({ x: 16, y: 22, w: 72, h: 34 }, { x: 112, y: 22, w: 72, h: 34 }).d).toBe('M88 39H110');
    expect(routeEdge({ x: 208, y: 22, w: 72, h: 34 }, { x: 196, y: 96, w: 96, h: 54 }).d).toBe('M244 56V94');
    expect(routeEdge({ x: 196, y: 96, w: 96, h: 54 }, { x: 30, y: 164, w: 120, h: 34 }).d).toBe('M196 123H90V162');
    expect(routeEdge({ x: 196, y: 96, w: 96, h: 54 }, { x: 296, y: 22, w: 68, h: 34 }).d).toBe('M292 123H330V58');
  });
});
