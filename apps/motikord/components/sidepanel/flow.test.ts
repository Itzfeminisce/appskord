import { describe, expect, it, vi } from 'vitest';
import { getPackV3 } from '../../lib/look/packs';
import { testRecipe } from '../../lib/pipeline/v3/testClip';
import { createFlow, type FlowDeps } from './flow';

vi.mock('../../lib/db', async (orig) => ({ ...(await orig<typeof import('../../lib/db')>()), getBrandKit: async () => undefined }));

const look = { style: 'auto', pace: 'normal', mood: 'upbeat' } as const;
const draft = { prompt: 'An 18-second launch for Fieldnote 2.0.', attached: [] };

function setup(over: Partial<FlowDeps> = {}) {
  const deps: FlowDeps = {
    plan: async () => testRecipe(),
    brand: async () => undefined,
    save: async () => undefined,
    openEditor: async () => undefined,
    check: async () => undefined,
    tick: async () => undefined,
    now: () => 1_700_000_000_000,
    ...over,
  };
  return { deps, flow: createFlow(deps) };
}

const planned = async (over: Partial<FlowDeps> = {}) => {
  const s = setup(over);
  await s.flow.plan(draft, look);
  expect(s.flow.get().stage).toBe('keyframes');
  return s;
};

describe('flow', () => {
  it('shows planning before the gate settles, and plan-failed when it rejects', async () => {
    const { flow } = setup();
    let refuse!: (e: Error) => void;
    const running = flow.plan(draft, look, new Promise((_, r) => { refuse = r; }));
    expect(flow.get().stage).toBe('planning');
    refuse(new Error('no access'));
    await running;
    expect(flow.get().stage).toBe('plan-failed');
  });

  it('ends in motion-failed when the brand kit cannot load', async () => {
    const { flow, deps } = await planned();
    await flow.approveAll();
    deps.brand = () => Promise.reject(new Error('db closed'));
    await expect(flow.addTheMotion()).resolves.toBeUndefined();
    expect(flow.get().stage).toBe('motion-failed');
  });

  it('clears the drawing mark when drawing another fails', async () => {
    const { flow, deps } = await planned();
    deps.tick = () => Promise.reject(new Error('gone'));
    await expect(flow.another(0)).resolves.toBeUndefined();
    expect(flow.get().drawing).toEqual([]);
  });

  it('clear drops the story but keeps the pack and the look', async () => {
    const { flow } = await planned();
    flow.choosePack('bold');
    const chosen = flow.get().look;
    flow.clear();
    expect(flow.get()).toMatchObject({ stage: 'idle', packId: getPackV3('bold').id, look: chosen });
    expect(flow.get().board).toBeUndefined();
    expect(flow.get().recipe).toBeUndefined();
  });
});
