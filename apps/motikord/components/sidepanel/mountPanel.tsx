// Test helper: mounts the side panel's router on a screen, with the flow's network and database deps faked.
import { act } from 'react';
import { vi } from 'vitest';
import { settle } from '../../test/mountRouter';
import { testRecipe } from '../../lib/pipeline/v3/testClip';
import type { Clip } from '../../lib/types';
import { flow, flowDeps } from './flow';

export const saved: Clip[] = [];
export const opened: string[] = [];

/** A flow that plans the LookLock frame's five scenes, saves to `saved` and opens to `opened`. */
export function fakeFlow(check: typeof flowDeps.check = async () => undefined) {
  flow.reset();
  saved.length = 0;
  opened.length = 0;
  Object.assign(flowDeps, {
    plan: vi.fn(async () => testRecipe()),
    brand: async () => undefined,
    save: async (c: Clip) => { saved.push(c); },
    openEditor: async (id: string) => { opened.push(id); },
    check,
    now: () => 1_700_000_000_000,
  });
}

/** Presses the button, link or radio with that text or aria-label, then lets the screen settle. */
export async function press(host: HTMLElement, text: string | RegExp) {
  const has = (v: string | null) => (typeof text === 'string' ? (v ?? '').trim() === text : text.test(v ?? ''));
  const el = [...host.querySelectorAll<HTMLElement>('button, a, [role=radio]')].find((b) => has(b.textContent) || has(b.getAttribute('aria-label')));
  if (!el) throw new Error(`no button "${String(text)}"`);
  await act(async () => { el.click(); });
  await settle();
  return el;
}

/** Settles until `done()` holds (the flow loads its engine on demand). */
export async function until(done: () => boolean) {
  for (let i = 0; i < 50 && !done(); i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
