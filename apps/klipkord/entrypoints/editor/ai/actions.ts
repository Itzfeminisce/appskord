import { useEffect, useRef } from 'react';
import { AiError, askOps, type Checked } from '@/lib/ai/ops';
import { discardHighlight, makeHighlight, newCutOf } from '@/lib/ai/highlight';
import { aiWins } from '@/lib/ai/suggest';
import { LLMError } from '@/lib/llm';
import type { Project } from '@/lib/project/types';
import type { Unit } from '@/lib/wordCuts';
import { aiDeps, callWith, header, setup } from './deps';
import { aiState, clearWins, setAi, setWins, useWins, winsOf, type AiStatus } from './store';

type Edit = (op: (p: Project) => Project) => void;

let running: AbortController | null = null;

/** Maps a failed call to its state: no key is not-set-up, no network is offline, anything else failed. */
export function statusOf(error: unknown): AiStatus | 'stopped' {
  if (error instanceof AiError) return error.code === 'stopped' ? 'stopped' : error.code;
  if (error instanceof LLMError) {
    if (error.code === 'no-key') return 'not-set-up';
    if (error.code === 'cancelled') return 'stopped';
    if (error.code === 'offline' && !aiDeps().online()) return 'offline';
  }
  return 'failed';
}

/** Reads the keys for the header; not-set-up when there are none. */
export async function checkSetup(): Promise<boolean> {
  try {
    const s = await setup();
    setAi((st) => ({ provider: s ? header(s.provider) : '', ...(!s && st.status === 'idle' && { status: 'not-set-up' as const }), ...(s && st.status === 'not-set-up' && { status: 'idle' as const }) }));
    return !!s;
  } catch (error) {
    console.error('Klipkord: could not read the AI keys', error);
    return false;
  }
}

/**
 * Sends a request. The reply becomes a draft that waits while the person keeps editing; a reply with a new cut becomes
 * a highlight cut on trial right away.
 */
export async function ask(request: string, { project, units, edit }: { project: () => Project; units: Unit[]; edit: Edit }): Promise<void> {
  const text = request.trim();
  if (!text) return;
  running?.abort();
  if (!aiDeps().online()) { setAi({ status: 'offline', request: text }); return; }
  const s = await setup().catch(() => null);
  if (!s) { setAi({ status: 'not-set-up', request: text, provider: '' }); return; }
  const controller = new AbortController();
  running = controller;
  setAi({ status: 'thinking', request: text, planned: 0, provider: header(s.provider) });
  try {
    const checked = await askOps({
      request: text, project: project(), units, cards: true, call: callWith(s.keys, controller.signal),
      onPart: (_done, _of, n) => { if (running === controller) setAi({ planned: n }); },
    });
    if (running !== controller) return;
    running = null;
    // With the panel closed a new cut waits like a draft, and is made when Ask AI opens again.
    if (newCutOf(checked.ops) && aiState().panel === 'ask') tryHighlight(text, checked, { units, edit });
    else setAi({ status: 'idle', reply: { request: text, checked }, off: new Set() });
  } catch (error) {
    if (running !== controller) return;
    running = null;
    const status = statusOf(error);
    if (status === 'stopped') { setAi({ status: 'idle' }); return; }
    if (status === 'failed') console.error('Klipkord: could not plan the AI edit', error);
    setAi({ status, cant: error instanceof AiError ? error.detail ?? '' : '' });
  }
}

/** Makes a reply's new cut and puts it on trial, replacing a cut already on trial. */
export function tryHighlight(request: string, checked: Pick<Checked, 'ops' | 'labels'>, { units, edit }: { units: Unit[]; edit: Edit }): void {
  const old = aiState().trial;
  let made: { cutId: string; back: string } | null = null;
  edit((p) => {
    const from = old && p.cuts.some((c) => c.id === old.cutId) ? discardHighlight(p, { id: old.cutId, back: old.back }) : p;
    const next = makeHighlight(from, units, checked);
    made = { cutId: next.current, back: from.current };
    return next;
  });
  setAi({ status: 'idle', reply: null, off: new Set(), trial: made ? { ...(made as { cutId: string; back: string }), request, labels: checked.labels, ops: checked.ops } : null });
}

/** "Stop": the call is cancelled and nothing changes. */
export function stop(): void {
  running?.abort();
  running = null;
  setAi({ status: 'idle' });
}

/** Keeps T6's SuggestedEdits fed with AI rows once per project, when an AI is set up and the computer is online. */
export function useAiWins(project: Project, units: Unit[], wanted: boolean) {
  const list = useWins(project.id);
  const running = useRef<AbortController | null>(null);
  // Only unmounting stops the ask; edits re-run the effect but must not cancel it.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (!wanted || winsOf(project.id) || !units.length || !aiDeps().online()) return;
    setWins(project.id, []);
    const controller = new AbortController();
    running.current = controller;
    void (async () => {
      const s = await setup();
      if (!s || controller.signal.aborted) return;
      const found = await aiWins(project, units, callWith(s.keys, controller.signal));
      // A stopped ask is asked again next time.
      if (controller.signal.aborted) clearWins(project.id);
      else setWins(project.id, found);
    })().catch((error: unknown) => console.error('Klipkord: could not suggest AI edits', error));
  }, [wanted, project, units]);
  return wanted ? list ?? [] : [];
}
