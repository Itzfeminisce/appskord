// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneV3 } from '@appskord/motion/types';
import type { AnimateResult } from '../../lib/pipeline/v3/animateLayer';
import type { BundledAsset } from './AssetPicker';
import { EditorV3Provider, useEditorV3 } from './context';
import { EditorV3, type EditorV3Props } from './EditorV3';
import { sampleClip } from './fixture';
import type { Bakers } from './LayerTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unmounts: (() => void)[] = [];
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { for (const u of unmounts.splice(0)) u(); vi.restoreAllMocks(); });

const clip = sampleClip();
const headlineId = clip.v3.scenes[0]!.layers.find((l) => l.slotId === 'headline')!.id;

async function open(props: Partial<EditorV3Props> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<EditorV3 clip={structuredClone(clip)} {...props} initial={{ layerId: headlineId, ...props.initial }} />); });
  unmounts.push(() => { act(() => root.unmount()); host.remove(); });
  const all = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
  const find = (sel: string, text: string | RegExp) => all(sel).find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent ?? '')));
  const click = async (el: Element | undefined) => {
    expect(el, 'element to click').toBeTruthy();
    await act(async () => { (el as HTMLElement).click(); });
  };
  const button = (text: string | RegExp) => find('button', text);
  const tab = (name: string) => click(all('[role="tab"]').find((e) => e.textContent === name));
  /** The newest entry's title in the Changes tab. */
  const newest = async () => {
    await tab('Changes');
    return host.querySelector('[role="tabpanel"] li span')?.textContent;
  };
  return { host, all, find, click, button, tab, newest };
}

describe('shared chrome', () => {
  it('shows Add, Effects, Look, Brand, Check, Export and the 320 px panel tabs', async () => {
    const go = vi.fn();
    const v = await open({ go, checkCount: 2 });
    for (const name of ['Add', 'Effects', 'Brand', 'Export']) expect(v.button(name), name).toBeTruthy();
    expect(v.button(/^Look/)).toBeTruthy();
    expect(v.button(/^Check/)?.textContent).toBe('Check2');
    expect(v.all('[role="tab"]').map((e) => e.textContent)).toEqual(['Scene', 'Layer', 'Motion', 'Changes']);
    expect(v.host.querySelectorAll('aside')[1]!.style.width).toBe('320px');
    expect(v.host.textContent).toContain('Saved on this computer');
    await v.click(v.button('Brand'));
    await v.click(v.button(/^Check/));
    await v.click(v.button('Export'));
    await v.click(v.button(/^Look/));
    expect(go.mock.calls.map((c) => c[0])).toEqual(['brand', 'check', 'export', 'look']);
  });
});

describe('Voice button', () => {
  it('sits between Brand and Check, opens CaptionsVoice, and the bar follows the frame', async () => {
    const v = await open();
    const names = v.all('header button').map((b) => b.textContent ?? '').filter((t) => /^(Brand|Voice|Check)/.test(t));
    expect(names.map((n) => n.replace(/\d+$/, ''))).toEqual(['Brand', 'Voice', 'Check']);
    const header = v.host.querySelector('header')!;
    expect(header.style.gap).toBe('6px');
    expect(v.button('Voice')!.style.padding).toBe('0px 10px');
    expect(v.host.querySelector<HTMLInputElement>('input[aria-label="Clip name"]')!.style.width).toBe('152px');
    expect(v.button('Voice')!.title).toBe('Voice and captions');
    await v.click(v.button('Voice'));
    expect(v.host.textContent).toContain('Off by default. Change it in Settings.');
    await v.click(v.button('Voice'));
    expect(v.host.textContent).not.toContain('Off by default. Change it in Settings.');
  });
});

describe('Motion tab', () => {
  it('writes comes in, feel and hold to the recipe and lists each in Changes', async () => {
    const v = await open();
    expect(v.all('[role="tab"][aria-selected="true"]')[0]!.textContent).toBe('Motion');
    await v.click(v.button('Per letter'));
    expect(v.host.textContent).toMatch(/Per letter · \w+ · \d\.\d s/);
    await v.click(v.all('[role="radio"]').find((e) => e.textContent === 'Bouncy'));
    expect(v.host.textContent).toContain('Per letter · Bouncy · 0.7 s');
    await v.click(v.all('[role="radio"]').find((e) => e.textContent === 'Drift'));
    expect(v.host.textContent).toContain('Drift · 2 px');
    expect(await v.newest()).toMatch(/: Drift$/);
    expect(v.all('[role="tabpanel"] li').length).toBe(4);
  });
});

describe('EditorMotion top bar: sizes', () => {
  it('switches the size between 9:16, 1:1 and 16:9, and All sizes opens FormatsV3', async () => {
    const v = await open();
    const sizes = v.all('[role="radiogroup"][aria-label="Size"] [role="radio"]');
    expect(sizes.map((e) => e.textContent)).toEqual(['9:16', '1:1', '16:9']);
    expect(v.host.querySelector('canvas')!.parentElement!.style.aspectRatio).toBe('1920 / 1080');
    await v.click(sizes[1]);
    expect(v.all('[role="radiogroup"][aria-label="Size"] [aria-checked="true"]')[0]!.textContent).toBe('1:1');
    expect(v.host.querySelector('canvas')!.parentElement!.style.aspectRatio).toBe('1080 / 1080');
    expect(await v.newest()).toBe('Size 1:1');
    await v.click(v.button('All sizes'));
    expect(v.button('All sizes')!.getAttribute('aria-current')).toBe('page');
    expect(v.host.querySelector('h1')!.textContent).toBe(`${clip.recipe.name} · All sizes`);
    expect(v.all('[role="radiogroup"][aria-label="Size"] [aria-checked="true"]')).toHaveLength(0);
  });
});

describe('Tell Motikord what to change', () => {
  it('sits under the stage with Send, and Send waits for words', async () => {
    const v = await open();
    const input = v.host.querySelector<HTMLInputElement>('main input[aria-label="Tell Motikord what to change"]')!;
    expect(input.placeholder).toBe('Tell Motikord what to change');
    expect(v.host.querySelector<HTMLButtonElement>('main button[aria-label="Send"]')!.disabled).toBe(true);
  });
});

describe('Motion tab: curve', () => {
  it('drags a handle of the custom curve into one Curve change, and the timeline draws the motion curves', async () => {
    const v = await open();
    const svg = v.host.querySelector<SVGSVGElement>('svg[aria-label="Curve editor: snaps in, then settles. Drag the two handles."]')!;
    expect(svg).toBeTruthy();
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 266, height: 64, right: 266, bottom: 64, x: 0, y: 0, toJSON: () => ({}) });
    const before = svg.querySelector('[data-curve]')!.getAttribute('d');
    await act(async () => { svg.querySelector('[data-handle="0"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); });
    for (const x of [100, 134]) await act(async () => { svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: x, clientY: 56 })); });
    expect(svg.querySelector('[data-curve]')!.getAttribute('d')).not.toBe(before);
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); });
    expect(v.host.querySelector('svg[aria-label^="Curve editor"] [data-curve]')!.getAttribute('d')).not.toBe(before);
    expect(v.host.querySelector('svg[aria-label^="Curve editor"] [data-handle="0"]')!.getAttribute('cx')).toBe('134');
    expect(v.host.querySelectorAll('[data-motion-curve="in"]').length).toBeGreaterThan(0);
    expect(await v.newest()).toMatch(/: Curve$/);
    expect(v.all('[role="tabpanel"] li').length).toBe(2);
  });

  it('commits a cancelled drag once, and a click without a move not at all', async () => {
    const v = await open();
    let svg = v.host.querySelector<SVGSVGElement>('svg[aria-label^="Curve editor"]')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 266, height: 64, right: 266, bottom: 64, x: 0, y: 0, toJSON: () => ({}) });
    const down = () => act(async () => { svg.querySelector('[data-handle="1"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); });
    await down();
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); });
    await v.tab('Changes');
    expect(v.all('[role="tabpanel"] li').length).toBe(1);
    await v.tab('Motion');
    svg = v.host.querySelector<SVGSVGElement>('svg[aria-label^="Curve editor"]')!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 266, height: 64, right: 266, bottom: 64, x: 0, y: 0, toJSON: () => ({}) });
    await down();
    for (const x of [200, 220]) await act(async () => { svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: x, clientY: 10 })); });
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })); });
    await v.tab('Changes');
    expect(v.all('[role="tabpanel"] li').length).toBe(2);
  });

  it('draws a spring without handles', async () => {
    const v = await open();
    await v.click(v.all('[role="radio"]').find((e) => e.textContent === 'Spring'));
    expect(v.host.querySelector('[data-handle]')).toBeNull();
    expect(v.host.querySelector('svg[aria-label="Spring editor: 20% bounce. Drag the dot to change the bounce."] [data-curve]')!.getAttribute('d')).toMatch(/ L/);
  });
});

describe('Scene tab: camera and depth', () => {
  it('sets the camera move, focus and depth shadows', async () => {
    const v = await open({ initial: { tab: 'scene' } });
    expect(v.host.textContent).toContain('Camera and depth');
    expect(v.host.textContent).toContain('Further back moves less');
    await v.click(v.button('Orbit'));
    expect(await v.newest()).toMatch(/^Camera: Orbit \d+°$/);
    await v.tab('Scene');
    const select = v.host.querySelector<HTMLSelectElement>('select[aria-label="Focus on"]')!;
    await act(async () => { select.value = headlineId; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(await v.newest()).toMatch(/^Focus on: /);
    await v.tab('Scene');
    await v.click(v.host.querySelector('input[aria-label="Depth shadows"]')!);
    expect(await v.newest()).toBe('Depth shadows');
    await v.tab('Scene');
    await v.click(v.host.querySelector('input[aria-label="Show depth"]')!);
    expect(v.host.querySelector<HTMLInputElement>('input[aria-label="Show depth"]')!.checked).toBe(true);
  });
});

const fakeBakers = (): Bakers => ({
  particles: vi.fn(async (input: Parameters<Bakers['particles']>[0]) => ({ key: 'k', fps: input.fps, counts: [0], data: '' })),
  secondary: vi.fn(async (input: Parameters<Bakers['secondary']>[0]) => Object.fromEntries(input.bodies.map((b) => {
    const keys = Array.from({ length: 12 }, (_, i) => ({ t: i * 33, v: i }));
    return [b.id, { x: keys, y: keys, rotate: keys }];
  }))),
});

describe('Layer tab', () => {
  it('Light 3D: turns the words 3D and shows the lower-quality preview note', async () => {
    const v = await open({ initial: { tab: 'layer' } });
    expect(v.host.textContent).toContain('Extruded, lit and shaded.');
    await v.click(v.host.querySelector('button[role="switch"][aria-label="3D"]')!);
    expect(v.host.querySelector('button[aria-label="3D"]')!.getAttribute('aria-checked')).toBe('true');
    expect(v.host.textContent).toContain('Your computer previews 3D at lower quality. Export is always full quality.');
  });

  it('Particles: a new preset runs once and is saved with its settings', async () => {
    const bakers = fakeBakers();
    const i = clip.v3.scenes.findIndex((s) => s.layers.some((l) => l.kind === 'particles'));
    const id = clip.v3.scenes[i]!.layers.find((l) => l.kind === 'particles')!.id;
    const v = await open({ bakers, initial: { tab: 'layer', scene: i, layerId: id } });
    expect(v.host.textContent).toContain('Particles and physics');
    await v.click(v.button('Sparks'));
    expect(bakers.particles).toHaveBeenCalledOnce();
    expect(v.host.textContent).toContain('Particles · saved');
    expect(await v.newest()).toBe('Particles: Sparks');
  });

  it('Physics: Falls and settles is baked once and saved as moves', async () => {
    const bakers = fakeBakers();
    const shape = clip.v3.scenes[0]!.layers.find((l) => l.kind === 'shape')!.id;
    const v = await open({ bakers, initial: { tab: 'layer', layerId: shape } });
    await v.click(v.host.querySelector('button[aria-label="Falls and settles"]')!);
    expect(bakers.secondary).toHaveBeenCalledOnce();
    expect(v.host.querySelector('button[aria-label="Falls and settles"]')!.getAttribute('aria-checked')).toBe('true');
    expect(v.host.textContent).toContain('Physics runs once and is saved as moves, so preview and export match.');
  });
});

describe('Effects library', () => {
  it('previews an effect, then adds it to the layer', async () => {
    const v = await open();
    await v.click(v.button('Effects'));
    expect(v.host.textContent).toContain('Pick an effect to see it on the stage before you add it.');
    await v.click(v.find('[role="dialog"] button', /Glow$/));
    expect(v.host.textContent).toContain('A soft halo in your look’s light.');
    expect(v.host.textContent).toContain('Previewing Glow');
    await v.click(v.button(/^Add glow to /));
    expect(v.host.querySelector('[role="dialog"]')).toBeNull();
    expect(await v.newest()).toMatch(/^Glow added to /);
  });
});

describe('Asset picker', () => {
  it('adds a bundled, credited asset as a layer', async () => {
    const catalog: BundledAsset[] = [{ id: 'spark', kind: 'animation', name: 'Spark test', author: 'Test Author', licence: 'Test licence', file: '/assets/spark.lottie' }];
    const v = await open({ catalog });
    await v.click(v.button('Add'));
    expect(v.host.querySelector('section[aria-label="Add"]')).toBeTruthy();
    expect(v.host.textContent).toContain('Bundled with Motikord. Nothing is downloaded.');
    await v.click(v.host.querySelector('button[aria-label="Spark test, by Test Author · Test licence"]')!);
    expect(v.host.querySelector('[aria-label="Edit"] [aria-selected="true"]')!.textContent).toBe('Layer');
    expect(await v.newest()).toBe('Spark test added to scene 1');
  });
});

describe('Transitions', () => {
  it('opens from the timeline diamond and sets the cut', async () => {
    const v = await open();
    await v.click(v.host.querySelector('button[aria-label^="Transition into scene 2"]')!);
    expect(v.host.textContent).toContain('Things carry across');
    await v.click(v.find('[role="dialog"] button', 'Push'));
    await v.click(v.button('Done'));
    expect(await v.newest()).toBe('Transition into scene 2: Push');
  });
});

describe('Animate this layer', () => {
  it('sends the words, lands the new tracks in Changes and can undo them', async () => {
    const animate = vi.fn(async (input: { scene: SceneV3; layerId: string; name: string }): Promise<AnimateResult> => {
      const scene = structuredClone(input.scene);
      const layer = scene.layers.find((l) => l.id === input.layerId)!;
      layer.tracks = { opacity: [{ t: 0, v: 0 }, { t: 800, v: 1 }] };
      return { ok: true, scene, layer, title: `${input.name} animated`, line: 'Per letter, Bouncy, 0.8 s.', tokens: 10 };
    });
    const v = await open({ animate, by: 'groq' });
    await v.click(v.button('Animate this layer'));
    expect(v.host.textContent).toContain('Only this layer’s settings go to Groq, never your media.');
    await v.click(v.button('Drop and settle'));
    await v.click(v.button('Animate'));
    expect(animate.mock.calls[0]![0]).toMatchObject({ words: 'Drop and settle', layerId: headlineId });
    expect(v.host.querySelector('[role="status"]')?.textContent).toContain('Per letter, Bouncy, 0.8 s.');
    await v.click(v.find('[role="status"] button', 'Undo'));
    await v.tab('Changes');
    // Undone, it waits above the list to come forward again.
    expect(v.find('[role="tabpanel"] li', /animated/)?.style.opacity).toBe('0.55');
    expect(v.button('Redo')).toBeTruthy();
  });
});

describe('Changes tab', () => {
  it('lists newest first with Undo, Go back here, Redo and the kept v2 version', async () => {
    const onOpenV2 = vi.fn();
    const v = await open({ onOpenV2, initial: { tab: 'scene' } });
    await v.click(v.button('Hold'));
    await v.tab('Scene');
    await v.click(v.button('Pan'));
    await v.tab('Changes');
    expect(v.host.textContent).toContain('Newest first');
    expect(v.host.textContent).toContain('Your v2 version is kept here');
    expect(v.button('Undo')).toBeTruthy();
    expect(v.all('button').filter((b) => b.textContent === 'Go back here')).toHaveLength(2);
    await v.click(v.button('Undo'));
    expect(v.button('Redo')).toBeTruthy();
    await v.click(v.button('Redo'));
    expect(v.host.querySelector('[role="tabpanel"] li span')?.textContent).toMatch(/^Camera: Pan/);
    await v.click(v.button('Open v2 version'));
    expect(onOpenV2).toHaveBeenCalledOnce();
    expect(v.host.textContent).toContain('Going back keeps the later changes in this list, so you can come forward again.');
  });
});

describe('Timeline keyframes', () => {
  it('moves a keyframe with the arrow keys and the top bar undoes it', async () => {
    const v = await open();
    const diamonds = v.all('button[aria-label*=" key at "]');
    const name = v.host.querySelector('main span span')!.textContent!;
    const last = diamonds.filter((d) => d.getAttribute('aria-label')!.startsWith(`${name} key at`)).at(-1)!;
    await act(async () => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(await v.newest()).toMatch(/: \d\.\d s → \d\.\d s$/);
    await v.click(v.host.querySelector('button[aria-label="Undo"]')!);
    expect(v.all('[role="tabpanel"] li').length).toBe(2);
  });
});

describe('update', () => {
  it('returns the state it made, so a caller can tell a refused change from an applied one', async () => {
    let api!: ReturnType<typeof useEditorV3>;
    const Probe = () => { api = useEditorV3(); return null; };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(<EditorV3Provider clip={structuredClone(clip)}><Probe /></EditorV3Provider>); });
    unmounts.push(() => { act(() => root.unmount()); });
    const before = api.state;
    let refused: unknown;
    await act(async () => { refused = api.update((st) => st); });
    expect(refused).toBe(before);
    let made: unknown;
    await act(async () => { made = api.update((st) => ({ ...st, scene: 1 })); api.update((st) => ({ ...st, tab: 'Changes' as never })); });
    expect((made as typeof before).scene).toBe(1);
    expect(api.state.scene).toBe(1);
  });
});
