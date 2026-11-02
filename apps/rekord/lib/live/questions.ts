// Questions put to you in a live meeting, and turning one into your promise. Pure.
import type { MemoryItem } from '../memory/types';
import type { Segment } from '../types';

export interface AskedYou { id: string; speaker: string; text: string; atMs: number }

/** Sentences someone else said that end in "?" and ask you ("Can you send the deck today?"). */
export function questionsForYou(segments: Segment[], nameOf: (s: Segment) => string): AskedYou[] {
  const out: AskedYou[] = [];
  for (const s of segments) {
    if (s.speaker === 'you' || s.interim) continue;
    const sentences = s.text.match(/[^.!?]*\?/g) ?? [];
    sentences.forEach((raw, n) => {
      const text = raw.trim();
      if (!/\byou\b/i.test(text)) return;
      out.push({ id: `${s.id}:${n}`, speaker: nameOf(s), text, atMs: s.startMs });
    });
  }
  return out;
}

const ASKS = /^(?:can|could|will|would)\s+you\s+(?:please\s+)?/i;

/** "Can you send the deck today?" → "Send the deck today". */
export function promiseText(question: string): string {
  const rest = question.trim().replace(/\?+$/, '').replace(ASKS, '').trim();
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** The open promise "Add as my promise" saves: yours, owed to whoever asked, with their words as the quote. */
export function promiseFromQuestion(q: AskedYou, meetingId: string, now: number, toId?: string, newId: () => string = () => crypto.randomUUID()): MemoryItem {
  return {
    id: newId(), kind: 'promise', status: 'open', text: promiseText(q.text),
    quote: { speaker: q.speaker, text: q.text, meetingId, atMs: q.atMs },
    meetingId, ownerId: 'me', ...(toId ? { toId } : {}), personIds: toId ? [toId] : [],
    history: [], createdAt: now, updatedAt: now,
  };
}
