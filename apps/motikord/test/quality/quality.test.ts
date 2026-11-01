import { describe, expect, it } from 'vitest';
import prompts from './prompts.json';
import { check } from '../../lib/checker';
import { CALL_BUDGET } from '../../lib/ai/writeRecipe';
import { writeClip } from '../../lib/ai/writeRecipe';
import { validateRecipe } from '../../lib/recipe/validate';
import type { FetchLike } from '../../lib/llm';
import type { Asset, Aspect, ClipType, Pace, StyleId } from '../../lib/types';

interface Recorded {
  id: string; type: ClipType; aspect: Aspect; style: StyleId; pace: Pace; prompt: string; model?: string; assets?: Asset[];
  replies: { storyboard: string; fills: string[]; critic?: string; fixes?: Record<string, string> };
}
type Part = string | { type: string; text?: string };
type Sent = { messages: { content: string | Part[] }[]; max_tokens?: number; max_completion_tokens?: number };

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const textOf = (c: string | Part[]) => (typeof c === 'string' ? c : c.map((p) => (typeof p === 'string' ? p : (p.text ?? ''))).join(''));
const imagesIn = (c: string | Part[]) => (typeof c === 'string' ? 0 : c.filter((p) => typeof p !== 'string' && p.type === 'image_url').length);

/** Replays the recorded replies by which call it is, and keeps each call's token count (3 characters a token, 1,000 an image). */
function replay(r: Recorded) {
  const calls: { kind: string; tokens: number }[] = [];
  const fetch: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Sent;
    const system = textOf(body.messages[0]!.content);
    const last = textOf(body.messages.at(-1)!.content);
    const tokens = Math.ceil(body.messages.reduce((n, m) => n + textOf(m.content).length, 0) / 3)
      + body.messages.reduce((n, m) => n + imagesIn(m.content) * 1000, 0) + (body.max_tokens ?? body.max_completion_tokens ?? 0);
    const kind = system.startsWith('You plan') ? 'storyboard' : system.startsWith('You write the words') ? 'fill' : system.includes('checking small frames') ? 'critic' : 'other';
    calls.push({ kind, tokens });
    if (kind === 'storyboard') return ok(r.replies.storyboard);
    if (kind === 'critic') return ok(r.replies.critic ?? '{"notes":[]}');
    if (kind === 'fill') {
      const i = Number(/Scene (\d+) of/.exec(last)?.[1]) - 1;
      const fix = last.includes('Change:') ? r.replies.fixes?.[String(i)] : undefined;
      return ok(fix ?? r.replies.fills[i] ?? '{}');
    }
    return ok('{}');
  };
  return { fetch, calls };
}

const tinyFrame = 'data:image/jpeg;base64,/9j/2wBDAP8=';

describe('quality set: 20 recorded prompts through the whole v2 pipeline', () => {
  const set = prompts as Recorded[];

  it('covers every clip type, all three sizes and each pack five times', () => {
    expect(set).toHaveLength(20);
    expect(new Set(set.map((p) => p.type)).size).toBe(7);
    expect(new Set(set.map((p) => p.aspect)).size).toBe(3);
    for (const s of ['clean', 'bold', 'playful', 'corporate']) expect(set.filter((p) => p.style === s)).toHaveLength(5);
  });

  for (const r of set) {
    it(`${r.id} passes the checker, every call under ${CALL_BUDGET} tokens`, async () => {
      const { fetch, calls } = replay(r);
      const model = r.model ?? 'llama-3.3-70b-versatile';
      const out = await writeClip(
        { prompt: r.prompt, type: r.type, aspect: r.aspect, assets: r.assets ?? [], id: r.id, style: r.style, pace: r.pace, critic: true, settings: { ai: 'cloud', provider: 'groq', models: { groq: model } } },
        { ai: 'cloud', provider: 'groq', model, key: 'gsk_test', fetch },
        { frames: async (_rec, times) => times.map(() => tinyFrame) },
      );
      expect(validateRecipe(out.recipe)).toEqual([]);
      expect(out.recipe.version).toBe(2);
      expect(out.recipe.scenes.every((s) => s.template)).toBe(true);
      expect(check(out.recipe).map((i) => `${i.kind} ${i.sceneId} ${i.layerId} ${i.note ?? ''}`)).toEqual([]);
      expect(calls.filter((c) => c.kind === 'fill').length).toBeGreaterThanOrEqual(out.recipe.scenes.length);
      if (r.model) expect(calls.some((c) => c.kind === 'critic')).toBe(true);
      else expect(out.criticSkipped).toBe('critic-not-available');
      for (const c of calls) expect(c.tokens).toBeLessThan(CALL_BUDGET);
    });
  }
});
