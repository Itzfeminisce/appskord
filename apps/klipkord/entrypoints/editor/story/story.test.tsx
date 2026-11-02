// @vitest-environment happy-dom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandStore, KLIPKORD_ID, MOTIKORD_ID, answerBrand, type BrandArea, type BrandRecord, type BrandRuntime } from '@appskord/brand';
import { currentCut } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import type { Cut, Overlay, Project, Source } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import { BrandKit } from '../dialogs/BrandKit';
import { select, timelineState } from '../timeline/store';
import { saveBrand, setBrandEnv } from './brand';
import { OverlayHandles } from './Handles';
import { dragBox, newOverlay, toPicture } from './model';
import { OverlayPanel } from './OverlayPanel';
import { StoryPanel } from './Panel';
import { setStory, storyState } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const screen: Source = { id: 'screen', kind: 'screen', file: 'screen.webm', mime: 'video/webm', offset: 0, duration: 60_000, width: 1920, height: 1080, video: true, audio: false };
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 60_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], markers: [], v3: { sources: ['screen'], events: true } } as unknown as Recording;

/** 0..20 s kept, 30..60 s kept: rec 30 s plays at output 20 s. */
function setup(overlays: Overlay[] = []): Project {
  const project = fromRecording(rec, [screen]);
  const cut: Cut = { ...currentCut(project), clips: [{ id: 'a', in: 0, out: 20_000, speed: 1 }, { id: 'b', in: 30_000, out: 60_000, speed: 1 }], overlays };
  return { ...project, sources: [screen], events: true, cuts: [cut], current: cut.id };
}
const lastStep = (p: Project) => p.history[p.current]!.undo.at(-1)!.label;

function area(): BrandArea {
  const data: Record<string, unknown> = {};
  return { get: async (key) => (key in data ? { [key]: data[key] } : {}), set: async (items) => { Object.assign(data, items); } };
}

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((c) => c()); setBrandEnv(null); select(null); setStory({ panel: false, brandKit: false }); });

function render(ui: ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.title === name || b.getAttribute('aria-label') === name)!;
  return { host, button };
}

function props(project: Project, out = 0) {
  const edit = vi.fn();
  const p = { recording: rec, project, cut: currentCut(project), out, length: 50_000, playing: false, ready: true, readOnly: false, seek: vi.fn(), play: vi.fn(), edit } satisfies SlotProps;
  return { p, edit };
}

/** A local brand store and no Motikord installed. */
function localBrand(): void {
  setBrandEnv({ store: brandStore(area()), runtime: { sendMessage: () => Promise.reject(new Error('not installed')), onMessageExternal: { addListener: vi.fn(), removeListener: vi.fn() } } });
}

describe('Text and cards panel', () => {
  it('adds a blur at the playhead in recording time, selects it and closes', async () => {
    localBrand();
    setStory({ panel: true });
    const { p, edit } = props(setup(), 25_000);
    const { host, button } = render(<StoryPanel {...p} />);
    for (const text of ['Text and cards', 'Text', 'Arrow', 'Callout', 'Highlight', 'Spotlight', 'Blur', 'Cards', 'from Motikord', 'Brand kit', 'Edit']) expect(host.textContent).toContain(text);
    act(() => button('Blur').click());
    const next = edit.mock.calls[0]![0](p.project) as Project;
    const [blur] = currentCut(next).overlays;
    expect(blur).toMatchObject({ kind: 'blur', at: 35_000, end: 38_000, motion: 'fade', blur: { mode: 'blur', amount: 0.9, follow: false } });
    expect(lastStep(next)).toBe('Added a blur');
    expect(timelineState().selected).toEqual({ kind: 'overlays', ids: [blur!.id] });
    expect(storyState().panel).toBe(false);
  });

  it('adds a title hook at the start with the recording\'s title, opens it and edits its slots and pack', () => {
    localBrand();
    const { p, edit } = props(setup(), 25_000);
    const { host, button } = render(<StoryPanel {...p} />);
    for (const text of ['Title hook', 'Start', 'End card', 'Finish', 'Logo sting', '1.5 s']) expect(host.textContent).toContain(text);
    act(() => button('Title hookStart').click());
    const next = edit.mock.calls[0]![0](p.project) as Project;
    const [card] = currentCut(next).cards;
    expect(card).toMatchObject({ template: 'title-hook', at: 0, ms: 3000, pack: 'clean', slots: { headline: 'Demo' } });
    expect(lastStep(next)).toBe('Added a title hook');
    expect(timelineState().selected).toEqual({ kind: 'cards', ids: [card!.id] });

    const opened = render(<StoryPanel {...props(next).p} edit={edit} />);
    const labels = [...opened.host.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['Headline · 6 words max', 'Kicker · optional']);
    expect(opened.host.textContent).toContain('Style pack');
    act(() => opened.button('Bold').click());
    const bold = edit.mock.calls[1]![0](next) as Project;
    expect(currentCut(bold).cards[0]!.pack).toBe('bold');
    expect(lastStep(bold)).toBe('Changed the title hook at 00:00');
    act(() => opened.button('Title hookStart').click());
    expect(edit).toHaveBeenCalledTimes(2);
    act(() => opened.button('Edit').click());
    expect(storyState().brandKit).toBe(true);
  });

  it('puts an end card at the finish and a logo sting at the playhead, overlaying without adding time', () => {
    localBrand();
    const { p, edit } = props(setup(), 25_000);
    const { button } = render(<StoryPanel {...p} />);
    act(() => button('End cardFinish').click());
    act(() => button('Logo sting1.5 s').click());
    const end = currentCut(edit.mock.calls[0]![0](p.project) as Project);
    const sting = currentCut(edit.mock.calls[1]![0](p.project) as Project);
    // Output 47 s is rec 57 s; output 25 s is rec 35 s.
    expect(end.cards[0]).toMatchObject({ template: 'end-card', at: 57_000, ms: 3000, slots: {} });
    expect(sting.cards[0]).toMatchObject({ template: 'logo-sting', at: 35_000, ms: 1500 });
    expect(end.clips).toEqual(p.cut.clips);
  });
});

describe('overlay inspector', () => {
  const blur: Overlay = { id: 'b', kind: 'blur', at: 14_000, end: 33_000, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.1 }, motion: 'fade', blur: { mode: 'blur', amount: 0.6, follow: false } };

  it('shows the Overlays frame and changes the blur as one named step each', () => {
    const project = setup([blur]);
    const { p, edit } = props(project);
    const { host, button } = render(<OverlayPanel p={p} o={blur} />);
    for (const text of ['Blur', 'Pixelate', 'Solid', 'Amount', 'Strong', 'Follow the element', 'Tracks this box as the page scrolls. Tab recordings only.', 'Timing', 'Shows', '0:14.0 to 0:23.0', 'Fade', 'Pop', 'None', 'Keep for the whole video'])
      expect(host.textContent).toContain(text);
    act(() => button('Pixelate').click());
    const a = edit.mock.calls[0]![0](project) as Project;
    expect(currentCut(a).overlays[0]!.blur!.mode).toBe('pixelate');
    expect(lastStep(a)).toBe('Changed the blur at 00:14');
    act(() => (host.querySelector('input[role="switch"]') as HTMLInputElement).click());
    expect(currentCut(edit.mock.calls[1]![0](project) as Project).overlays[0]!.blur!.follow).toBe(true);
    act(() => button('Pop').click());
    expect(currentCut(edit.mock.calls[2]![0](project) as Project).overlays[0]!.motion).toBe('pop');
    const whole = host.querySelectorAll('input[role="switch"]')[1] as HTMLInputElement;
    act(() => whole.click());
    expect(currentCut(edit.mock.calls[3]![0](project) as Project).overlays[0]).toMatchObject({ at: 0, end: 60_000 });
  });

  it('turns follow off for screen recordings without events', () => {
    const project = { ...setup([blur]), events: false };
    const { p } = props(project);
    const { host } = render(<OverlayPanel p={p} o={blur} />);
    expect((host.querySelector('input[role="switch"]') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('placing on the preview', () => {
  it('moves and resizes a box and keeps it from collapsing', () => {
    const b = { x: 0.4, y: 0.3, w: 0.2, h: 0.1 };
    expect(dragBox(b, 'move', 0.1, -0.1)).toEqual({ x: 0.5, y: expect.closeTo(0.2), w: 0.2, h: 0.1 });
    expect(dragBox(b, 'se', 0.1, 0.1)).toEqual({ x: 0.4, y: 0.3, w: expect.closeTo(0.3), h: expect.closeTo(0.2) });
    expect(dragBox(b, 'nw', 0.5, 0.5)).toEqual({ x: expect.closeTo(0.58), y: expect.closeTo(0.38), w: expect.closeTo(0.02), h: expect.closeTo(0.02) });
    expect(toPicture(192, 108, { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 1920, h: 1080 })).toEqual({ dx: 0.05, dy: 0.05 });
  });

  it('starts each kind at the playhead with its own box and text', () => {
    const cut = currentCut(setup());
    expect(newOverlay(cut, 'callout', 5000, 60_000)).toMatchObject({ kind: 'callout', at: 5000, end: 8000, text: '' });
    expect(newOverlay(cut, 'arrow', 59_000, 60_000)).toMatchObject({ at: 0, end: 3000 });
    expect(newOverlay(cut, 'arrow', 49_000, 60_000)).toMatchObject({ at: 59_000, end: 60_000 });
  });
});

describe('preview handles', () => {
  it('draws the selected blur\'s box with its tag and commits a drag as one step', () => {
    const blur: Overlay = { id: 'b', kind: 'blur', at: 0, end: 10_000, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.1 }, motion: 'none', blur: { mode: 'blur', amount: 0.6, follow: true } };
    const project = setup([blur]);
    const { p, edit } = props(project, 1000);
    select({ kind: 'overlays', ids: ['b'] });
    const { host } = render(<OverlayHandles {...p} />);
    const box = host.querySelector('[data-overlay-box="b"]') as HTMLElement;
    expect(box.textContent).toBe('Blur · follows the page');
    (box.parentElement as HTMLElement).getBoundingClientRect = () => ({ width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540, toJSON: () => ({}) });
    const fire = (type: string, x: number) => box.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 0, pointerId: 1 }));
    act(() => { fire('pointerdown', 100); });
    act(() => { fire('pointermove', 196); });
    act(() => { fire('pointerup', 196); });
    const next = edit.mock.calls[0]![0](project) as Project;
    const moved = currentCut(next).overlays[0]!.box;
    expect(moved.x).toBeGreaterThan(0.4);
    expect(moved.y).toBe(0.3);
    expect(lastStep(next)).toBe('Changed the blur at 00:00');
  });
});

describe('corner resize', () => {
  it('commits one undo step for a corner drag', () => {
    const blur: Overlay = { id: 'b', kind: 'blur', at: 0, end: 10_000, box: { x: 0.4, y: 0.3, w: 0.2, h: 0.1 }, motion: 'none', blur: { mode: 'blur', amount: 0.9, follow: false } };
    const project = setup([blur]);
    const { p, edit } = props(project, 1000);
    select({ kind: 'overlays', ids: ['b'] });
    const { host } = render(<OverlayHandles {...p} />);
    const box = host.querySelector('[data-overlay-box="b"]') as HTMLElement;
    (box.parentElement as HTMLElement).getBoundingClientRect = () => ({ width: 960, height: 540, x: 0, y: 0, top: 0, left: 0, right: 960, bottom: 540, toJSON: () => ({}) });
    const corner = host.querySelector('[data-handle="se"]') as HTMLElement;
    const fire = (type: string, x: number) => corner.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: x, pointerId: 1 }));
    act(() => { fire('pointerdown', 100); });
    act(() => { fire('pointermove', 150); });
    act(() => { fire('pointerup', 150); });
    expect(edit).toHaveBeenCalledTimes(1);
    const next = edit.mock.calls[0]![0](project) as Project;
    expect(next.history[next.current]!.undo.length - project.history[project.current]!.undo.length).toBe(1);
    expect(currentCut(next).overlays[0]!.box.w).toBeGreaterThan(0.2);
  });
});

describe('brand kit dialog', () => {
  it('shows the BrandKit frame, saves colours and fonts, and offers the kit to Motikord', async () => {
    const mine = brandStore(area());
    const theirs = brandStore(area());
    let listener: Parameters<BrandRuntime['onMessageExternal']['addListener']>[0] | undefined;
    const motikord: BrandRuntime = { sendMessage: vi.fn(), onMessageExternal: { addListener: (l) => { listener = l; }, removeListener: vi.fn() } };
    answerBrand(motikord, theirs, [KLIPKORD_ID]);
    const runtime: BrandRuntime = {
      sendMessage: vi.fn((peer, message) => new Promise((resolve) => { expect(peer).toBe(MOTIKORD_ID); listener!(message, { id: KLIPKORD_ID }, resolve); })),
      onMessageExternal: { addListener: vi.fn(), removeListener: vi.fn() },
    };
    setBrandEnv({ store: mine, runtime });
    const onClose = vi.fn();
    const onSave = vi.fn((r: BrandRecord) => saveBrand(r));
    const { host, button } = render(<BrandKit onClose={onClose} onSave={onSave} />);
    await act(async () => { await Promise.resolve(); });
    for (const text of ['Brand kit', 'Logo', 'Replace', 'Colours', 'Main', 'Ink', 'Paper', 'Accent', 'Fonts', 'Shared with Motikord on this computer. A change here shows in both apps.', 'Used by cards, captions, backgrounds and the logo sting.', 'Cancel', 'Save'])
      expect(host.textContent).toContain(text);
    const colour = host.querySelector('input[aria-label="Main"]') as HTMLInputElement;
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(colour, '#2563eb'); colour.dispatchEvent(new Event('input', { bubbles: true })); });
    const heading = host.querySelector('select[aria-label="Headings"]') as HTMLSelectElement;
    act(() => { heading.value = 'Inter'; heading.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { button('Save').click(); await new Promise((r) => setTimeout(r, 0)); });
    const saved = onSave.mock.calls[0]![0];
    expect(saved.kit).toEqual({ colours: [{ hex: '#2563EB', role: 'primary' }], headingFont: 'Inter', bodyFont: 'Inter', useForNewClips: false });
    expect(await mine.load()).toEqual(saved);
    expect(await theirs.load()).toEqual(saved);
    expect(onClose).toHaveBeenCalled();
  });

  it('reads Motikord\'s newer kit when it opens', async () => {
    const mine = brandStore(area());
    await mine.save({ kit: { colours: [{ hex: '#111111', role: 'primary' }], useForNewClips: false }, updatedAt: 1 });
    const newer: BrandRecord = { kit: { colours: [{ hex: '#0F172A', role: 'text' }], bodyFont: 'Inter', useForNewClips: true }, updatedAt: 9 };
    setBrandEnv({ store: mine, runtime: { sendMessage: vi.fn(async () => ({ brand: newer })), onMessageExternal: { addListener: vi.fn(), removeListener: vi.fn() } } });
    const { host } = render(<BrandKit onClose={vi.fn()} onSave={vi.fn()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain('#0F172A');
    expect((host.querySelector('select[aria-label="Text"]') as HTMLSelectElement).value).toBe('Inter');
    expect(await mine.load()).toEqual(newer);
  });
});
