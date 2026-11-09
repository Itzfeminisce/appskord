// Test fixture: a five-scene v2 clip from the LookLock frame's words, and fake Groq replies by call.
import { vi } from 'vitest';
import { expandScene, getPack, type Scene } from '@appskord/scenes';
import type { TemplateId } from '@appskord/scenes';
import { getPackV3, packLook } from '../../look/packs';
import type { FetchLike } from '../../llm';
import type { Recipe } from '../../types';

export const PACK = getPackV3('studio');
export const LOOK = { ...packLook(PACK), id: 'look-morning', name: 'Morning shift' };

const SCENES: [TemplateId, Record<string, string | string[]>][] = [
  ['title-hook', { kicker: 'Fieldnote 2.0', headline: 'Notes that find you' }],
  ['big-statement', { statement: 'Every meeting sorted before you leave the room', highlight: 'sorted' }],
  ['stat-reveal', { number: '3 h', label: 'saved per person, every week' }],
  ['list', { title: 'How it works', items: ['Open a note', 'Walk away', 'Find it later'] }],
  ['end-card', { cta: 'Try Fieldnote free', handle: 'fieldnote.app' }],
];

/** The v2 recipe behind the frames, in Bold, with the pack's own colours swapped for the look guide's. */
export function testRecipe(): Recipe {
  const bold = getPack('bold')!;
  const scenes: Scene[] = SCENES.map(([template, slots], i) => {
    const s = expandScene({ id: `sc${i + 1}`, durationMs: 3000, background: '#0A0A0A', layout: 'center', layers: [], template, slots }, bold);
    for (const l of s.layers) {
      if (l.type === 'text') l.colour = LOOK.palette[1] ?? LOOK.palette[0]!;
      if (l.type === 'shape') l.fill = LOOK.palette[0]!;
    }
    return s;
  });
  return { version: 2, id: 'c1', name: 'Morning shift', type: 'promo', aspect: '9:16', style: 'bold', scenes, assets: {} };
}

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
type Body = { model: string; max_tokens: number; messages: { content: string | { type: string; text?: string }[] }[] };
const text = (c: Body['messages'][number]['content']) => (typeof c === 'string' ? c : c.map((p) => p.text ?? '').join(''));

export type Reply = string | Response | (() => Response);
/** A fake Groq that answers by call: a pass of the quality check (story, look, motion) or animate. */
export function fakeGroq(replies: Partial<Record<'story' | 'look' | 'motion' | 'animate', Reply>>) {
  const sent: { kind: string; body: Body; raw: string }[] = [];
  const fetch: FetchLike = vi.fn(async (_u, init) => {
    const raw = String(init?.body);
    const body = JSON.parse(raw) as Body;
    const system = text(body.messages[0]!.content);
    const kind = system.startsWith('You animate')
      ? 'animate'
      : system.includes('\nStory:')
        ? 'story'
        : system.includes('\nSame look throughout:')
          ? 'look'
          : 'motion';
    sent.push({ kind, body, raw });
    const r = replies[kind as keyof typeof replies] ?? (kind === 'animate' ? '{}' : '{"notes":[]}');
    return typeof r === 'string' ? ok(r) : typeof r === 'function' ? r() : r;
  });
  return { fetch, sent, opts: { ai: 'cloud' as const, provider: 'groq' as const, model: 'openai/gpt-oss-120b', key: 'gsk_test', fetch } };
}
