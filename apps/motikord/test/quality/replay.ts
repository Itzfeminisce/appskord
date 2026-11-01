import type { FetchLike } from '../../lib/llm';
import type { Asset, Aspect, ClipType, Pace, StyleId } from '../../lib/types';

export interface Recorded {
  id: string; type: ClipType; aspect: Aspect; style: StyleId; pace: Pace; prompt: string; model?: string; assets?: Asset[];
  replies: { storyboard: string; fills: string[]; critic?: string; fixes?: Record<string, string> };
}
type Part = string | { type: string; text?: string };
type Sent = { messages: { content: string | Part[] }[]; max_tokens?: number; max_completion_tokens?: number };

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const textOf = (c: string | Part[]) => (typeof c === 'string' ? c : c.map((p) => (typeof p === 'string' ? p : (p.text ?? ''))).join(''));
const imagesIn = (c: string | Part[]) => (typeof c === 'string' ? 0 : c.filter((p) => typeof p !== 'string' && p.type === 'image_url').length);

/** Replays the recorded replies by which call it is, and keeps each call's token count (3 characters a token, 1,000 an image). */
export function replay(r: Recorded) {
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

export const tinyFrame = 'data:image/jpeg;base64,/9j/2wBDAP8=';
