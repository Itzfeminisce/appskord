// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { note, PASSES } from '../../lib/critic/v3/checks';
import type { PassResult, QualityResult } from '../../lib/critic/v3';
import CriticV3 from './CriticV3';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
afterEach(() => { for (const u of unmounts.splice(0)) u(); });

const pass = (i: number, p: Partial<PassResult> = {}): PassResult => ({ id: PASSES[i]!.id, name: PASSES[i]!.name, ran: true, notes: [], frames: 8, tokens: 0, ...p });
const result = (passes: PassResult[], extra: Partial<QualityResult> = {}): QualityResult => ({
  recipe: {} as never, clip: { scenes: Array.from({ length: 7 }, () => 0) } as never, passes, toLookAt: passes.flatMap((p) => p.notes), fixed: [], questions: [], fixesUsed: {}, ...extra,
});

async function show(r: QualityResult, props: Partial<Parameters<typeof CriticV3>[0]> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<CriticV3 name="Morning shift" provider="Groq" result={r} {...props} />); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const click = async (text: string) => {
    const el = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
    if (!el) throw new Error(`no "${text}"`);
    await act(async () => { el.click(); });
  };
  return { host, click };
}

const full = () => result(
  [
    pass(0, { notes: [note('repeat', 3, 'ai', { other: 1 }), note('words', 1, 'check', { words: 9, limit: 6, slot: 'headline' })] }),
    pass(1, { notes: [note('colour', 2, 'check'), note('camera', 4, 'ai')] }),
    pass(2, { notes: [note('flat', 1, 'ai'), note('plastic', 5, 'ai'), note('generic', 0, 'ai'), note('stiff', 2, 'check')] }),
  ],
  { fixed: [{ sceneIndex: 3, kind: 'stiff', line: 'Scene 4 headline now overlaps by 40 ms', before: {} as never }, { sceneIndex: 6, kind: 'words', line: 'Scene 7 call to action moved inside the safe area', before: {} as never }] },
);

describe('CriticV3', () => {
  it('shows the frame copy for three passes with fixes', async () => {
    const { host } = await show(full());
    for (const text of [
      'Quality check', 'Morning shift · 7 scenes', '8 things to look at · 2 fixed for you', 'Groq looked at 8 small frames per pass',
      'Story', 'Same look throughout', 'Look and motion', 'Ran', '2 to look at', '4 to look at',
      'Scene 4 repeats scene 2’s point', 'Merge scenes', 'Scene 2 headline is 3 words over its limit', 'It has 9 words. This slot fits 6.', 'Shorten it',
      'Scene 3 uses a colour outside your look guide', 'Use guide colour', 'Scene 5 camera is busier than the rest', 'Calm the camera',
      'Flat', 'Scene 2 looks flat', 'Add depth', 'Plastic', 'Scene 6 glow looks plastic', 'Soften the glow', 'Generic', 'Scene 1 could be any brand', 'Make key word bigger',
      'Stiff timing', 'Scene 3 lines land together', 'Overlap the lines', 'Show me',
      'Fixed for you', 'Scene 4 headline now overlaps by 40 ms', 'Scene 7 call to action moved inside the safe area', 'Undo',
      'One automatic fix per scene, then Motikord asks you.', 'Fix all 8', 'Check again',
    ]) expect(host.textContent, text).toContain(text);
  });

  it('wires the buttons', async () => {
    const h = { onFix: vi.fn(), onShow: vi.fn(), onUndo: vi.fn(), onFixAll: vi.fn(), onCheckAgain: vi.fn() };
    const { click } = await show(full(), h);
    await click('Merge scenes');
    await click('Undo');
    await click('Fix all 8');
    await click('Check again');
    expect(h.onFix).toHaveBeenCalledWith(expect.objectContaining({ kind: 'repeat' }));
    expect(h.onUndo).toHaveBeenCalledWith(0);
    expect(h.onFixAll).toHaveBeenCalled();
    expect(h.onCheckAgain).toHaveBeenCalled();
  });

  it('a model that can’t see images shows critic-not-available on the look passes', async () => {
    const onChangeModel = vi.fn();
    const r = result([pass(0), pass(1, { ran: false, state: 'critic-not-available', frames: 0 }), pass(2, { ran: false, state: 'critic-not-available', frames: 0 })]);
    const { host, click } = await show(r, { onChangeModel });
    expect(host.querySelectorAll('[data-state=critic-not-available]')).toHaveLength(2);
    expect(host.textContent).toContain('Your model can’t see images');
    await click('Change model');
    expect(onChangeModel).toHaveBeenCalled();
  });

  it('a failed AI pass shows critic-ai-failed, with the free notes still listed', async () => {
    const onRetry = vi.fn();
    const r = result([pass(0), pass(1), pass(2, { ran: false, state: 'critic-ai-failed', notes: [note('stiff', 2, 'check')] })]);
    const { host, click } = await show(r, { onRetry });
    expect(host.querySelector('[data-state=critic-ai-failed]')!.textContent).toContain('Groq didn’t answer. Your free checks still ran, so their notes are below. Try again to run the AI pass.');
    expect(host.textContent).toContain('Scene 3 lines land together');
    await click('Try again');
    expect(onRetry).toHaveBeenCalled();
  });

  it('a missing key keeps key-needed and is not shown as critic-ai-failed', async () => {
    const onPasteKey = vi.fn();
    const r = result([pass(0, { ran: false, state: 'key-needed' }), pass(1, { ran: false, state: 'key-needed' }), pass(2, { ran: false, state: 'key-needed' })]);
    const { host, click } = await show(r, { onPasteKey });
    expect(host.querySelector('[data-state=critic-ai-failed]')).toBeNull();
    expect(host.textContent).toContain('Paste your key again');
    await click('Paste a key');
    expect(onPasteKey).toHaveBeenCalled();
  });

  it('a scene past its one automatic fix shows critic-fix-limit', async () => {
    const n = note('flat', 1, 'ai');
    const r = result([pass(0), pass(1), pass(2, { notes: [n] })], { questions: [{ sceneIndex: 1, copy: {} as never }] });
    const { host } = await show(r);
    expect(host.querySelector('[data-state=critic-fix-limit]')!.textContent).toContain('Scene 2 still needs your eye');
  });
});
