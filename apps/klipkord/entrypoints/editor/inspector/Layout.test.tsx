// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentCut } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import type { Cut, Project, Source } from '@/lib/project/types';
import { layoutAt, renderPlan, SWITCH_MS } from '@/lib/render/plan';
import { ease } from '@/lib/render/spring';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import { buildRows } from '../timeline/rows';
import { activeSwitch, cameraKind, LayoutPanel, pickLayout } from './Layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (id: string, kind: Source['kind'], w: number, h: number): Source =>
  ({ id, kind, file: `${id}.webm`, mime: 'video/webm', offset: 0, duration: 60_000, width: w, height: h, video: true, audio: false });
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 60_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], markers: [], v3: { sources: ['screen', 'camera'], events: false } } as unknown as Recording;

/** 0..20 s kept, 30..60 s kept: output 0..50 s, rec 30 s plays at output 20 s. */
function setup(sources: Source[] = [src('screen', 'screen', 1920, 1080), src('camera', 'camera', 640, 480)]): Project {
  const project = fromRecording(rec, sources);
  const cut: Cut = { ...currentCut(project), clips: [{ id: 'a', in: 0, out: 20_000, speed: 1 }, { id: 'b', in: 30_000, out: 60_000, speed: 1 }] };
  return { ...project, sources, cuts: [cut], current: cut.id };
}
const cutOf = (p: Project) => currentCut(p);
const lastStep = (p: Project) => p.history[p.current]!.undo.at(-1)!.label;

describe('pickLayout', () => {
  it('adds a switch at the playhead in recording time, labelled with the output time', () => {
    const p = pickLayout(setup(), 36_000, 'side');
    expect(cutOf(p).layouts).toEqual([expect.objectContaining({ at: 46_000, layout: 'side', switch: 'cut' })]);
    const smooth = { ...cutOf(p), layouts: cutOf(p).layouts.map((s) => ({ ...s, switch: 'smooth' as const })) };
    expect(lastStep(p)).toBe('Switched to Side by side at 00:36');
    expect(layoutAt(cutOf(p), 45_999, true).to).toBe('bubble');
    expect(layoutAt(cutOf(p), 46_000, true)).toEqual({ from: 'bubble', to: 'side', progress: 1 });
    expect(layoutAt(smooth, 46_000, true)).toEqual({ from: 'bubble', to: 'side', progress: 0 });
    expect(layoutAt(smooth, 46_000 + SWITCH_MS / 2, true).progress).toBeCloseTo(ease(0.5));
    expect(layoutAt(smooth, 46_000 + SWITCH_MS, true).progress).toBe(1);
  });

  it('changes the switch already at the playhead, removes it when it goes back, and ignores the current layout', () => {
    const one = pickLayout(setup(), 36_000, 'side');
    expect(pickLayout(one, 40_000, 'side')).toBe(one);
    const two = pickLayout(one, 36_000, 'camera');
    expect(cutOf(two).layouts).toHaveLength(1);
    expect(cutOf(two).layouts[0]!.layout).toBe('camera');
    expect(cutOf(pickLayout(two, 36_000, 'bubble')).layouts).toEqual([]);
  });

  it('at 0:00 changes the first layout, which is not shown as a switch', () => {
    const p = pickLayout(setup(), 0, 'screen');
    expect(cutOf(p).layouts[0]).toMatchObject({ at: 0, layout: 'screen' });
    expect(activeSwitch(cutOf(p), 10_000)).toBeNull();
    expect(renderPlan(p, cutOf(p), 1000).camera).toBeUndefined();
  });
});

describe('layout boxes', () => {
  it('moves the camera from the bubble to beside the screen at the switch', () => {
    const p = pickLayout(setup(), 36_000, 'side');
    const cut = cutOf(p);
    const before = renderPlan(p, cut, 35_000);
    const after = renderPlan(p, cut, 36_000);
    expect(before.camera!.dest.w).toBe(before.camera!.dest.h);
    expect(after.camera!.dest.x).toBeGreaterThanOrEqual(after.screen!.dest.x + after.screen!.dest.w);
    expect(after.camera!.dest.h).toBeGreaterThan(before.camera!.dest.h);
    expect([before.camera!.shape, after.camera!.shape]).toEqual(['round', 'rounded']);
  });
});

describe('Camera track markers', () => {
  it('shows each layout stretch with the switch block movable', () => {
    const p = pickLayout(setup(), 36_000, 'side');
    const cut = cutOf(p);
    const spans = [{ clip: cut.clips[0]!, index: 0, start: 0, end: 20_000 }, { clip: cut.clips[1]!, index: 1, start: 20_000, end: 50_000 }];
    const camera = buildRows(p, cut, spans, { start: 0, end: 50_000 }).find((r) => r.key === 'camera')!;
    expect(camera.blocks.map((b) => [b.label, b.start, b.end, b.movable])).toEqual([
      ['Bubble', 0, 20_000, false], ['', 20_000, 36_000, false], ['Side by side', 36_000, 50_000, true],
    ]);
    expect(camera.blocks[2]).toMatchObject({ kind: 'layouts', id: cut.layouts[0]!.id });
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function mount(project: Project, out = 0) {
  const edit = vi.fn();
  const props = { recording: rec, project, cut: cutOf(project), out, length: 50_000, playing: false, ready: true, readOnly: false,
    seek: vi.fn(), play: vi.fn(), edit } satisfies SlotProps;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<LayoutPanel {...props} />));
  cleanups.push(() => { act(() => root.unmount()); host.remove(); });
  const button = (name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;
  return { host, edit, button };
}

describe('LayoutPanel', () => {
  it('shows the Editor frame: tiles, bubble settings, blur and mirror', () => {
    const { host, edit, button } = mount(setup());
    for (const text of ['Camera layout', 'from 0:00', 'Bubble', 'Side by side', 'Camera full', 'Screen only', 'Size', 'M', 'Round', 'Rounded', 'Camera', 'Blur behind you', 'Light preview here. Full quality when you export.', 'Mirror', 'Shape', '9:16',
      'To switch layouts partway through, move the playhead and pick another. Each switch shows as a marker on the Camera track.']) expect(host.textContent).toContain(text);
    expect(button('Bubble').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Top right').click());
    const next = edit.mock.calls[0]![0](setup()) as Project;
    expect(cutOf(next).camera.corner).toBe('top-right');
    expect(lastStep(next)).toBe('Changed the camera');
  });

  it('shows the CameraLayout frame after a switch: the line, Switch and Blur / Colour', () => {
    let p = pickLayout(setup(), 36_000, 'side');
    p = { ...p, cuts: p.cuts.map((c) => ({ ...c, layouts: c.layouts.map((s) => ({ ...s, switch: 'smooth' as const })), camera: { ...c.camera, blur: { ...c.camera.blur, on: true } } })) };
    const { host, button } = mount(p, 36_000);
    expect(host.textContent).toContain('from 0:36');
    expect(host.textContent).toContain('Bubble until 0:36, then side by side. Drag the marker on the Camera track to move the switch.');
    expect(button('Smooth').getAttribute('aria-checked')).toBe('true');
    expect(button('Cut')).toBeTruthy();
    expect(button('Colour')).toBeTruthy();
    expect(host.textContent).not.toContain('Rounded');
  });

  it('disables the tiles without a camera, with the frame copy', () => {
    const none = setup([src('screen', 'screen', 1920, 1080)]);
    expect(cameraKind(none)).toBe('none');
    const a = mount(none);
    expect(a.button('Bubble').disabled).toBe(true);
    expect(a.host.textContent).toContain('This recording has no camera');
    expect(a.host.textContent).not.toContain('Blur behind you');
    const baked = setup([src('screen', 'baked', 1920, 1080)]);
    const b = mount(baked);
    expect(b.button('Side by side').disabled).toBe(true);
    expect(b.host.textContent).toContain('The camera is part of the screen video, so camera layouts and background blur are off. Everything else works.');
  });
});
