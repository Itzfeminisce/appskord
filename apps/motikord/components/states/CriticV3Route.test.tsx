// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { QualityResult } from '../../lib/critic/v3';
import { getPackV3, packLook } from '../../lib/look/packs';
import type { RestyledClip } from '../../lib/restyle/restyle';
import { sampleClip } from '../editor/fixture';
import { CriticV3Live, type CriticDeps } from './CriticV3Route';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
afterEach(() => { for (const u of unmounts.splice(0)) u(); });

const look = packLook(getPackV3('studio'));
function result(clip: RestyledClip, o: Partial<QualityResult> = {}): QualityResult {
  return {
    recipe: clip.recipe, clip: clip.v3, toLookAt: [], fixed: [], questions: [], fixesUsed: {},
    passes: [
      { id: 'story', name: 'Story', ran: true, notes: [], frames: 0, tokens: 10 },
      { id: 'look', name: 'Look', ran: false, state: 'key-needed', notes: [], frames: 0, tokens: 0 },
      { id: 'motion', name: 'Motion', ran: true, notes: [], frames: 4, tokens: 10 },
    ],
    ...o,
  };
}

async function open(deps: CriticDeps, clip = sampleClip()) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<CriticV3Live clip={clip} look={look} provider="Groq" deps={deps} />); });
  for (let i = 0; i < 20 && !host.querySelector('[data-frame="CriticV3"] h1'); i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  return host;
}

describe('CriticV3 route', () => {
  it('runs the quality check on the clip and shows its passes; key-needed shows the key card', async () => {
    const checked: string[] = [];
    const host = await open({ check: async (clip) => { checked.push(clip.id); return result(clip); }, save: async () => undefined });
    expect(checked).toEqual(['clip-1']);
    expect([...host.querySelectorAll('section h2')].map((h) => h.textContent)).toEqual(expect.arrayContaining(['Story', 'Look', 'Motion']));
    expect(host.textContent).toContain('Paste your key again');
  });

  it('saves the automatic fixes as one Change by the check, and Check again passes the fixes used', async () => {
    const saved: RestyledClip[] = [];
    const used: (Record<string, number> | undefined)[] = [];
    const host = await open({
      check: async (clip, _look, _signal, fixesUsed) => {
        used.push(fixesUsed);
        const renamed = { ...clip.recipe, name: 'Fixed name' };
        return result(clip, { recipe: renamed, fixed: [{ sceneIndex: 0, kind: 'words', line: 'Scene 1 words trimmed', before: { recipe: clip.recipe, clip: clip.v3 } }], fixesUsed: { s1: 1 } });
      },
      save: async (c) => { saved.push(c); },
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.recipe.name).toBe('Fixed name');
    expect(saved[0]!.history.at(-1)).toMatchObject({ by: 'check' });
    expect(host.textContent).toContain('Scene 1 words trimmed');
    const again = [...host.querySelectorAll('button')].find((b) => /again/i.test(b.textContent ?? ''))!;
    await act(async () => { again.click(); await new Promise((r) => setTimeout(r, 5)); });
    expect(used.at(-1)).toEqual({ s1: 1 });
  });
});
