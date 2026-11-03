import { describe, expect, it } from 'vitest';
import { LLMError } from '@appskord/llm';
import { emptyBoard } from '@/lib/board/ops';
import type { Board, Card, ImageCard, LinkCard } from '@/lib/board/types';
import { partFor, pickerGroups, share, storageTotals, withoutFile } from './model';

const base = { rect: { x: 0, y: 0, w: 200, h: 120 }, z: 1, colour: 'white' as const, say: '', createdAt: 1, updatedAt: 1 };
const link = (id: string, text: string, preview?: string): LinkCard =>
  ({ ...base, id, kind: 'link', title: id, url: `https://example.com/${id}`, site: 'example.com', text, words: 1, savedAt: 1, ...(preview ? { preview: { id: preview, name: 'preview.jpg', mime: 'image/jpeg', size: 10 } } : {}) }) as LinkCard;
const image = (id: string, fileId: string, name: string): ImageCard =>
  ({ ...base, id, kind: 'image', title: name, file: { id: fileId, name, mime: 'image/png', size: 999 } }) as ImageCard;

function board(id: string, name: string, cards: Card[]): Board {
  const b = emptyBoard({ board: id, section: `${id}-s` }, name, 'Agenda', 1);
  return { ...b, cards: Object.fromEntries(cards.map((c) => [c.id, c])) };
}

const json = (b: Board) => new TextEncoder().encode(JSON.stringify(b)).byteLength;

describe('storage totals', () => {
  const a = board('a', 'Q4 roadmap', [image('c1', 'f1', 'Roadmap.png'), link('c2', 'héllo', 'f2')]);
  const b = board('b', 'Support handoff', [link('c3', 'abc')]);
  const files = [
    { boardId: 'a', fileId: 'f1', size: 5000 },
    { boardId: 'a', fileId: 'f2', size: 300 },
    { boardId: 'a', fileId: 'orphan', size: 7 },
  ];

  it('adds files on disk, saved page text and the rest of each board', () => {
    const t = storageTotals([b, a], files);
    expect(t.files).toBe(5307);
    expect(t.pageText).toBe(6 + 3); // UTF-8 bytes, "é" is two
    expect(t.boards).toBe(json(a) + json(b) - 9);
    expect(t.total).toBe(t.files + t.pageText + t.boards);
  });

  it('lists boards biggest first, counting real file sizes, not the card’s', () => {
    const t = storageTotals([b, a], files);
    expect(t.perBoard.map((r) => [r.name, r.cards, r.bytes])).toEqual([
      ['Q4 roadmap', 2, json(a) + 5307],
      ['Support handoff', 1, json(b)],
    ]);
  });

  it('names the largest files with their board, skipping files no card holds', () => {
    const t = storageTotals([a, b], files, 5);
    expect(t.largest.map((f) => [f.name, f.boardName, f.size, f.cardId])).toEqual([
      ['Roadmap.png', 'Q4 roadmap', 5000, 'c1'],
      ['preview.jpg', 'Q4 roadmap', 300, 'c2'],
    ]);
    expect(storageTotals([a], files, 1).largest).toHaveLength(1);
  });

  it('is all zero with no boards', () => {
    expect(storageTotals([], [])).toEqual({ total: 0, files: 0, pageText: 0, boards: 0, perBoard: [], largest: [] });
  });

  it('keeps the card and its name when its file is removed', () => {
    expect(withoutFile(image('c1', 'f1', 'Roadmap.png'), 'f1')).toMatchObject({ kind: 'image', file: { name: 'Roadmap.png', size: 0 } });
    expect(withoutFile(link('c2', 'x', 'f2'), 'f2')).not.toHaveProperty('preview');
    const other = image('c1', 'f1', 'a.png');
    expect(withoutFile(other, 'nope')).toBe(other);
  });

  it('gives bar segments a visible minimum and no more than the whole', () => {
    expect(share(0, 100)).toBe(0);
    expect(share(1, 10_000)).toBe(1);
    expect(share(50, 100)).toBe(50);
    expect(share(500, 100)).toBe(100);
  });
});

describe('settings parts', () => {
  it('opens "AI and keys" unless ?show= names another part', () => {
    expect(partFor(undefined)).toBe('ai');
    expect(partFor('storage')).toBe('storage');
    expect(partFor('privacy')).toBe('privacy');
    expect(partFor('nonsense')).toBe('ai');
  });
});

describe('picker groups', () => {
  const value = { provider: 'anthropic', model: 'claude-test-1' };

  it('lists every cloud provider in the shared order, with no on-this-computer group', () => {
    expect(pickerGroups(value, [], {}).map((g) => g.id)).toEqual(['groq', 'openai', 'anthropic', 'google', 'xai', 'openrouter']);
  });

  it('asks for a key where none is loaded', () => {
    const g = pickerGroups(value, [], {})[1]!;
    expect(g).toMatchObject({ name: 'OpenAI', status: 'needs-key', addKeyLabel: 'Add an OpenAI key', models: [] });
  });

  it('shows the live list, drops "Sees images", and keeps a typed choice', () => {
    const lists = { anthropic: { status: 'done' as const, list: { source: 'live' as const, models: [{ id: 'claude-a', tag: 'Recommended' as const }, { id: 'claude-b', tag: 'Sees images' as const }] } } };
    const g = pickerGroups(value, ['ANTHROPIC_API_KEY'], lists)[2]!;
    expect(g.status).toBe('ready');
    expect(g.models).toEqual([{ id: 'claude-a', tag: 'Recommended' }, { id: 'claude-b' }, { id: 'claude-test-1', tag: 'Your choice' }]);
  });

  it('marks a refused key and a list that did not load', () => {
    const refused = { status: 'done' as const, list: { source: 'suggested' as const, models: [], error: new LLMError('no', 'auth') } };
    const offline = { status: 'done' as const, list: { source: 'suggested' as const, models: [], error: new LLMError('no', 'offline') } };
    const groups = pickerGroups(value, ['ANTHROPIC_API_KEY', 'GROQ_API_KEY'], { anthropic: refused, groq: offline });
    expect(groups[2]!.status).toBe('key-refused');
    expect(groups[0]!.status).toBe('failed');
    expect(pickerGroups(value, ['GROQ_API_KEY'], { groq: { status: 'loading' } })[0]!.status).toBe('loading');
  });
});
