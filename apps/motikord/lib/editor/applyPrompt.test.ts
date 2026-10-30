import { describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../llm';
import { applyPatch } from '../patch';
import { applyPrompt } from './applyPrompt';
import { devSampleRecipe } from './store';

const KEY = 'gsk_test';
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
function groq(...contents: string[]) {
  const fetch: FetchLike = vi.fn(async () => {
    const next = contents.shift();
    if (next === undefined) throw new Error('no more replies');
    return reply(next);
  });
  return { fetch, opts: { ai: 'cloud' as const, key: KEY, fetch } };
}
const r = devSampleRecipe('p');
const slower = JSON.stringify({ ops: [0, 1, 2].map((i) => ({ op: 'replace', path: `/scenes/${i}/durationMs`, value: 6000 })) });

describe('applyPrompt', () => {
  it('turns a reply into one Change with the prompt and what it did', async () => {
    const out = await applyPrompt(r, 'Slower', groq(slower).opts);
    expect(out.by).toBe('groq');
    expect(out.edit.summary).toBe('“Slower”\nClip is now 18 s.');
    expect(out.detail).toBe('Clip is now 18 s.');
    expect(applyPatch(r, out.edit.ops).doc.scenes.map((s) => s.durationMs)).toEqual([6000, 6000, 6000]);
    expect(r.scenes[0]!.durationMs).toBe(5000);
  });

  it('fails with prompt-failed on an invalid reply and changes nothing', async () => {
    const before = structuredClone(r);
    const g = groq('not json', '{"ops":[{"op":"replace","path":"/assets/x","value":1}]}');
    await expect(applyPrompt(r, 'Bigger title', g.opts)).rejects.toMatchObject({ state: 'prompt-failed' });
    expect(g.fetch).toHaveBeenCalledTimes(2);
    expect(r).toEqual(before);
  });

  it('gives up after the timeout as Groq not responding', async () => {
    vi.useFakeTimers();
    try {
      const fetch: FetchLike = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
      }));
      const p = applyPrompt(r, 'Slower', { ai: 'cloud', key: KEY, fetch, timeoutMs: 1000 });
      const check = expect(p).rejects.toMatchObject({ state: 'groq-down' });
      await vi.advanceTimersByTimeAsync(1001);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it('Stop cancels with no state and no change', async () => {
    const ac = new AbortController();
    const fetch: FetchLike = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = applyPrompt(r, 'Slower', { ai: 'cloud', key: KEY, fetch, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: 'cancelled', state: undefined });
  });

  it('refuses a change past 60 seconds with its length', async () => {
    const long = JSON.stringify({ ops: [0, 1, 2].map((i) => ({ op: 'replace', path: `/scenes/${i}/durationMs`, value: 24_000 })) });
    await expect(applyPrompt(r, 'Much slower', groq(long).opts)).rejects.toMatchObject({ state: 'change-too-long', detail: { totalMs: 72_000 } });
  });
});
