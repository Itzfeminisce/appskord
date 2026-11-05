import { describe, expect, it } from 'vitest';
import { cardLabel } from './label';
import type { Card } from './types';

const base = { id: 'a', title: '', colour: 'white', rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0, say: '', createdAt: 0, updatedAt: 0 } as const;
const file = { id: 'f', name: 'roadmap.pdf', mime: 'application/pdf', size: 1 };

describe('cardLabel', () => {
  it('uses the title when set, on one line', () => {
    expect(cardLabel({ ...base, kind: 'note', title: '  Pricing\nnotes ', text: 'x' })).toBe('Pricing');
  });
  it('falls back to the content of each kind', () => {
    expect(cardLabel({ ...base, kind: 'note', text: '\n  First   line \nsecond' })).toBe('First line');
    expect(cardLabel({ ...base, kind: 'checklist', items: [{ id: '1', text: ' ', done: false }, { id: '2', text: 'Ship it', done: true }] })).toBe('Ship it');
    expect(cardLabel({ ...base, kind: 'diagram', diagram: { nodes: [{ id: 'n', kind: 'step', label: 'Cart', x: 0, y: 0, w: 1, h: 1, colour: 'white' }], edges: [] } })).toBe('Cart');
    expect(cardLabel({ ...base, kind: 'diagram', diagram: { nodes: [], edges: [] } })).toBe('Diagram');
    expect(cardLabel({ ...base, kind: 'image', file })).toBe('roadmap.pdf');
    expect(cardLabel({ ...base, kind: 'file', file })).toBe('roadmap.pdf');
    expect(cardLabel({ ...base, kind: 'link', url: 'https://www.example.com/a', site: '', text: '', words: 0, savedAt: 0 })).toBe('example.com');
    expect(cardLabel({ ...base, kind: 'link', url: 'https://example.com', site: 'Example', text: '', words: 0, savedAt: 0 })).toBe('Example');
  });
  it('names the kind when there is nothing else, and shortens long text', () => {
    expect(cardLabel({ ...base, kind: 'note', text: '' } as Card)).toBe('Note');
    expect(cardLabel({ ...base, kind: 'note', text: 'a'.repeat(200) }).length).toBe(80);
  });
});
