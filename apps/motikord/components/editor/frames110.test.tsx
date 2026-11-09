// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PromptEdit } from '../../lib/editor/applyPrompt';
import { applyPatch } from '../../lib/patch';
import { EditorV3, TOAST_MS, type EditorV3Props } from './EditorV3';
import { sampleClip } from './fixture';
import { ChangedTag } from './ui';

// FormatsV3, EditPromptV3 and CurveLabelsV3 in the v3 editor.

const clip = sampleClip();
const headlineId = clip.v3.scenes[0]!.layers.find((l) => l.slotId === 'headline')!.id;
const textAt = clip.recipe.scenes[1]!.layers.findIndex((l) => l.type === 'text');
const ops = [{ op: 'replace' as const, path: `/scenes/1/layers/${textAt}/text`, value: 'Fake words' }];
const answer: PromptEdit = { edit: { ops, summary: '“fake”\nThe words now read Fake words' }, by: 'groq', detail: 'The words now read Fake words', recipe: applyPatch(clip.recipe, ops).doc };

// The AI pipeline is replaced by a button that hands the editor a checked answer.
vi.mock('../../screens/editor/EditorPrompt', async (real) => ({
  ...(await real<object>()),
  PromptField: ({ apply }: { apply: (out: PromptEdit) => boolean }) => <button type="button" onClick={() => apply(answer)}>Fake send</button>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const unmounts: (() => void)[] = [];
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function open(props: Partial<EditorV3Props> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<EditorV3 clip={structuredClone(clip)} {...props} initial={{ layerId: headlineId, ...props.initial }} />); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
  const button = (text: string | RegExp) => all('button').find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent ?? '')));
  const click = async (el: Element | undefined) => {
    expect(el, 'element to click').toBeTruthy();
    await act(async () => { (el as HTMLElement).click(); });
  };
  const changesTab = () => all('[role="tab"]').find((e) => e.textContent === 'Changes')!;
  return { host, all, button, click, changesTab };
}

describe('FormatsV3 (All sizes)', () => {
  it('shows the three sizes with their uses, camera and depth line, and status', async () => {
    const v = await open();
    await v.click(v.button('All sizes'));
    const text = v.host.textContent ?? '';
    for (const s of ['9:16 · 1080 × 1920', 'Reels, Shorts, TikTok', '1:1 · 1080 × 1080', 'Feed posts', '16:9 · 1920 × 1080', 'YouTube, slides, web'])
      expect(text).toContain(s);
    expect(text).toContain('Changes apply to every size unless you choose “This size only”.');
    expect(text).toContain('Each template has its own layout per size, so nothing is just cropped. Motion, camera and depth are set for each size too. Dashed line: safe area.');
    expect(text).toMatch(/Scene 1 of \d+ · /);
    expect(v.all('figcaption span').filter((e) => / · \d+ depth layers$/.test(e.textContent ?? ''))).toHaveLength(3);
    expect(v.all('figcaption').every((f) => /Looks good|things? to check/.test(f.textContent ?? ''))).toBe(true);
    expect(v.all('canvas[role="img"]').map((c) => c.getAttribute('aria-label'))).toEqual(['9:16', '1:1', '16:9']);
    expect(v.button('Play all three')).toBeTruthy();
  });

  it('steps scenes, selects a size with setAspect, and goes back to the editor', async () => {
    const v = await open();
    await v.click(v.button('All sizes'));
    await v.click(v.all('button[aria-label="Next scene"]')[0]);
    expect(v.host.textContent).toMatch(/Scene 2 of /);
    const one = v.all('[role="button"][aria-label="1:1"]')[0]!;
    await v.click(one);
    expect(v.all('[role="button"][aria-label="1:1"]')[0]!.getAttribute('aria-pressed')).toBe('true');
    expect(v.all('[role="button"][aria-label="1:1"]')[0]!.style.outline).toContain('solid');
    expect(v.host.textContent).toContain('This size only (1:1)');
    await v.click(v.button('Back to the editor'));
    expect(v.host.querySelector('h1')).toBeNull();
    expect(v.all('[role="radiogroup"][aria-label="Size"] [aria-checked="true"]')[0]!.textContent).toBe('1:1');
  });
});

describe('EditPromptV3', () => {
  it('shows "Done." with Undo and See in Changes in place of the play row, jumps to the change and tags it', async () => {
    const v = await open();
    await v.click(v.button('Fake send'));
    const toast = v.all('[role="status"]').find((e) => e.textContent?.includes('Done.'))!;
    expect(toast.textContent).toContain('Done. The words now read Fake words.');
    expect(v.button('Play scene 2')!.parentElement!.style.display).toBe('none');
    expect(v.all('[aria-current="true"]')[0]!.textContent).toMatch(/^2 · /);
    expect(v.host.textContent).toMatch(/ · changed/);
    expect(v.changesTab().getAttribute('aria-label')).toBe('Changes, 1 new');
    await v.click(v.button('See in Changes'));
    expect(v.changesTab().getAttribute('aria-selected')).toBe('true');
    expect(v.changesTab().getAttribute('aria-label')).toBeNull();
    expect(v.all('[role="status"]').some((e) => e.textContent?.includes('Done.'))).toBe(false);
  });

  it('Undo takes back the whole prompt change and the tags go', async () => {
    const v = await open();
    await v.click(v.button('Fake send'));
    expect(v.host.textContent).toContain('Fake words');
    await v.click(v.button('Undo'));
    expect(v.host.textContent).not.toContain('Fake words');
    expect(v.host.textContent).not.toMatch(/ · changed/);
    expect(v.changesTab().getAttribute('aria-label')).toBeNull();
    expect(v.all('button[aria-label="Redo"]')[0]!.hasAttribute('disabled')).toBe(false);
  });

  it('stays 8 s, or until the next action', async () => {
    vi.useFakeTimers();
    const v = await open();
    await v.click(v.button('Fake send'));
    await act(async () => { vi.advanceTimersByTime(TOAST_MS - 100); });
    expect(v.button('See in Changes')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(v.button('See in Changes')).toBeUndefined();
    const w = await open();
    await w.click(w.button('Fake send'));
    expect(w.button('See in Changes')).toBeTruthy();
    await act(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    expect(w.button('See in Changes')).toBeUndefined();
  });

  it('a changed panel section carries a Changed tag', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(<ChangedTag />); });
    expect(host.textContent).toBe('Changed');
    act(() => root.unmount());
  });
});

describe('CurveLabelsV3 in the Motion tab', () => {
  it('labels the feel, turns a dragged shape into Custom curve with Reset to the feel the layer had', async () => {
    const v = await open();
    const label = () => v.host.querySelector('svg[aria-label^="Curve editor"]')!.previousElementSibling;
    expect(v.host.textContent).toContain('Snaps in, then settles');
    const svg = v.host.querySelector<SVGSVGElement>('svg[aria-label^="Curve editor"]')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 266, height: 64, right: 266, bottom: 64, x: 0, y: 0, toJSON: () => ({}) });
    await act(async () => { svg.querySelector('[data-handle="0"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); });
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 134, clientY: 56 })); });
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); });
    expect(v.host.querySelector('svg[aria-label="Curve editor: custom curve. Drag the two handles."]')).toBeTruthy();
    expect(v.host.textContent).toContain('Custom curve');
    expect(v.all('[role="radiogroup"][aria-label="Feel"] [aria-checked="true"]')).toHaveLength(0);
    await v.click(v.button('Reset to Snappy'));
    expect(v.host.textContent).toContain('Snaps in, then settles');
    expect(v.button('Reset to Snappy')).toBeUndefined();
    expect(label()).toBeTruthy();
  });

  it('snaps handles dropped within 0.02 of a feel to it', async () => {
    const v = await open();
    const svg = v.host.querySelector<SVGSVGElement>('svg[aria-label^="Curve editor"]')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 266, height: 64, right: 266, bottom: 64, x: 0, y: 0, toJSON: () => ({}) });
    // Handle 1 of Snappy sits at (0, 1); dropped at (0.01, 0.99) it snaps back.
    await act(async () => { svg.querySelector('[data-handle="1"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); });
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 16.4, clientY: 10.46 })); });
    expect(v.host.querySelector('svg[aria-label="Curve editor: snaps in, then settles. Drag the two handles."]')).toBeTruthy();
  });
});
