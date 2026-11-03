/** One AI run on a surface: working, then a result or a StatesAI state. Stop aborts the request. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiMeta } from '@/lib/ai/apply';
import { AiError, type AiCall } from '@/lib/ai/run';
import { getReady } from './choice';

export type AiStateName = 'ai-no-key' | 'ai-bad-reply' | 'ai-unreachable' | 'ai-key-refused' | 'ai-site-blocked';

export type Phase<T> =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'failed'; state: AiStateName; provider: string }
  | { kind: 'done'; value: T; meta: AiMeta };

export function useAiRun<T>(task: (call: AiCall, meta: AiMeta) => Promise<T>) {
  const [phase, setPhase] = useState<Phase<T>>({ kind: 'idle' });
  const ctrl = useRef<AbortController>(undefined);
  const live = useRef(task);
  live.current = task;

  const run = useCallback(async (asked: Promise<boolean> | undefined) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPhase({ kind: 'working' });
    let provider = '';
    try {
      const ready = await getReady(asked);
      provider = ready.provider;
      if (c.signal.aborted) return;
      if (!ready.ok) return setPhase({ kind: 'failed', state: ready.state, provider });
      const meta = { model: ready.model, provider: ready.provider };
      const value = await live.current({ provider: ready.provider, model: ready.model, key: ready.key, signal: c.signal }, meta);
      if (!c.signal.aborted) setPhase({ kind: 'done', value, meta });
    } catch (error) {
      if (c.signal.aborted) return;
      if (!(error instanceof AiError)) console.error('Briefkord: could not run the AI action', error);
      const state = error instanceof AiError ? error.state : 'ai-unreachable';
      setPhase(state === 'cancelled' ? { kind: 'idle' } : { kind: 'failed', state, provider });
    }
  }, []);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    setPhase({ kind: 'idle' });
  }, []);

  useEffect(() => () => ctrl.current?.abort(), []);
  return { phase, run, stop, setPhase };
}
