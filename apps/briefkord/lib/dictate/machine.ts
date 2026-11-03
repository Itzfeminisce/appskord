/** Dictate (frame Dictate): the mic's states, what a press does in each, and the timer. Pure. */

/** Why speaking stopped short; each maps to a StatesAI line. */
export type DictateFailure = 'key' | 'busy' | 'site' | 'failed';

export type DictatePhase =
  | { kind: 'idle' }
  /** Waiting on Chrome: the site prompt, the mic prompt, or the side panel's mic tab. */
  | { kind: 'asking' }
  | { kind: 'listening'; since: number }
  | { kind: 'writing' }
  | { kind: 'no-key' }
  | { kind: 'blocked' }
  | { kind: 'failed'; why: DictateFailure; provider: string };

export type DictateEvent =
  | { type: 'ask' }
  | { type: 'listen'; at: number }
  | { type: 'stop' }
  /** Esc while listening, or the text went in: back to the plain mic. */
  | { type: 'reset' }
  | { type: 'no-key' }
  | { type: 'blocked' }
  | { type: 'fail'; why: DictateFailure; provider: string };

export const IDLE: DictatePhase = { kind: 'idle' };

export function dictate(phase: DictatePhase, event: DictateEvent): DictatePhase {
  switch (event.type) {
    case 'ask':
      return phase.kind === 'listening' || phase.kind === 'writing' ? phase : { kind: 'asking' };
    case 'listen':
      return phase.kind === 'asking' || phase.kind === 'idle' ? { kind: 'listening', since: event.at } : phase;
    case 'stop':
      return phase.kind === 'listening' ? { kind: 'writing' } : phase;
    case 'reset':
      return IDLE;
    case 'no-key':
      return { kind: 'no-key' };
    case 'blocked':
      return { kind: 'blocked' };
    case 'fail':
      return { kind: 'failed', why: event.why, provider: event.provider };
  }
}

/** What pressing the mic does now. */
export function pressAction(phase: DictatePhase): 'start' | 'stop' | 'none' {
  if (phase.kind === 'listening') return 'stop';
  if (phase.kind === 'writing' || phase.kind === 'asking') return 'none';
  return 'start';
}

/** 7000 → "0:07". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Bar heights in px (4 to 18) for `count` bars from analyser bytes (0 to 255). */
export function barHeights(bytes: ArrayLike<number>, count: number): number[] {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(bytes.length / count));
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < step; j++) sum += bytes[i * step + j] ?? 0;
    out.push(Math.round(4 + (14 * Math.min(255, sum / step)) / 255));
  }
  return out;
}
