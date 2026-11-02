// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK } from '@/lib/project/cuts';
import { currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { addLayer } from '@/lib/project/ops';
import { cutLength } from '@/lib/project/time';
import type { Cut, Project, RecEvent } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import { LookPanel, paddingPct, paddingPx, shadowStop, SHADOWS } from './Look';
import { select } from '../timeline/store';
import { AutoZoomOnOpen, FocusStage, ZoomEdit, zoomPlace } from './ZoomEdit';

const events: RecEvent[] = [{ t: 2000, type: 'click', x: 0.3, y: 0.3 }, { t: 2300, type: 'click', x: 0.31, y: 0.3 }, { t: 8000, type: 'click', x: 0.8, y: 0.8 }];
vi.mock('../transcript/events', () => ({ useEvents: (p: Project) => (p.events ? events : []) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recording = { id: 'r', title: 'Invite', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], transcriptPending: false } as unknown as Recording;
let root: Root;
let host: HTMLElement;
let latest: Project;

type Panel = 'look' | 'zoom' | 'open' | 'stage';
const preview = vi.fn();
function Harness({ start, panel, readOnly = false }: { start: Project; panel: Panel; readOnly?: boolean }) {
  const [project, setProject] = useState(start);
  latest = project;
  const cut = currentCut(project);
  const edit = (op: (p: Project) => Project) => setProject((p) => op(p));
  const p: SlotProps = { recording, project, cut, out: 0, length: cutLength(cut), playing: false, ready: true, readOnly, seek: () => {}, play: () => {}, edit };
  if (panel === 'open') return <AutoZoomOnOpen {...p} />;
  if (panel === 'stage') return <FocusStage {...p} preview={preview} />;
  if (panel === 'zoom') return cut.zooms[0] ? <ZoomEdit p={p} zoom={cut.zooms[0]} /> : null;
  return <LookPanel {...p} />;
}
const render = (start: Project, panel: Panel, readOnly = false) => act(() => root.render(<Harness start={start} panel={panel} readOnly={readOnly} />));
const find = (name: string) => [...host.querySelectorAll<HTMLElement>('button, [role="switch"]')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;
const toggle = (name: string) => [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(name))!.querySelector('input')!;
const texts = () => [...host.querySelectorAll('input[type="range"]')].map((i) => i.nextElementSibling!.textContent);
/** Moves a slider like a drag; `release` ends it with a pointer up (the commit). */
function slide(name: string, value: number, release = false) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (release) act(() => { input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
}
const lastLabel = () => steps(latest).steps.at(-1)?.label;
const look = () => currentCut(latest).look;
const zooms = () => currentCut(latest).zooms;
/** A v3 recording's project: the design's default look. */
const designed = (): Project => { const p = fromRecording(recording); return { ...p, cuts: p.cuts.map((c) => ({ ...c, look: DEFAULT_LOOK })) }; };
const v3 = (): Project => ({ ...fromRecording(recording), events: true });
const withZooms = () => addLayer(v3(), { kind: 'zooms', items: [
  { at: 1000, end: 4000, depth: 1.6, focus: { x: 0.3, y: 0.3 }, feel: 'smooth', auto: true, why: '2 clicks' },
  { at: 7000, end: 9000, depth: 2, focus: 'cursor', feel: 'smooth', auto: false },
] });

beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); select(null); preview.mockClear(); });

describe('Look tab', () => {
  it('picks a background kind and swatch, each one named step', () => {
    render(fromRecording(recording), 'look');
    expect(find('Image')).toBeUndefined();
    act(() => find('Gradient').click());
    expect(look().background).toEqual({ kind: 'gradient', value: 'ember' });
    act(() => find('Background 2').click());
    expect(look().background.value).toBe('ocean');
    expect(lastLabel()).toBe('Changed background to Ocean');
    act(() => find('Blurred screen').click());
    expect(look().background.kind).toBe('blurred');
    act(() => find('Colour').click());
    expect(look().background).toEqual({ kind: 'colour', value: '#111114' });
    act(() => find('Background 3').click());
    expect(lastLabel()).toBe('Changed background to Sand');
  });

  it('sets cursor size, smoothing and clicks as cursor steps', () => {
    render(fromRecording(recording), 'look');
    act(() => find('Large').click());
    expect(look().cursor.size).toBe(1.5);
    act(() => toggle('Show clicks').click());
    act(() => toggle('Smooth the movement').click());
    expect(look().cursor).toEqual({ size: 1.5, smooth: false, clicks: false });
    expect(lastLabel()).toBe('Changed the cursor');
  });

  it('shows the frame values as the frame does', () => {
    expect(paddingPct(134, '16:9')).toBe(7);
    expect(paddingPx(20, '9:16')).toBe(216);
    expect(SHADOWS.map((s) => s.label)).toEqual(['None', 'Soft', 'Medium', 'Strong']);
    expect(shadowStop(24)).toBe(1);
  });

  it('shows the design defaults and keeps a committed value in its label', () => {
    render(designed(), 'look');
    expect(look().background).toEqual({ kind: 'gradient', value: 'ember' });
    expect(texts()).toEqual(['7%', '10 px', 'Soft']);
    slide('Padding', 12, true);
    slide('Corners', 20, true);
    slide('Shadow', 3, true);
    expect(texts()).toEqual(['12%', '20 px', 'Strong']);
    expect([look().padding, look().corners, look().shadow]).toEqual([230, 20, 60]);
  });

  it('shows a slider value live and commits one step on release', () => {
    render(designed(), 'look');
    slide('Corners', 4);
    expect(texts()[1]).toBe('4 px');
    expect(look().corners).toBe(10);
    slide('Corners', 4, true);
    expect(look().corners).toBe(4);
    expect(steps(latest).steps).toHaveLength(1);
  });

  it('changes nothing while read-only', () => {
    const start = fromRecording(recording);
    render(start, 'look', true);
    act(() => find('Colour').click());
    act(() => find('Large').click());
    expect(latest).toBe(start);
    expect([...host.querySelectorAll('input[type="range"]')].every((i) => (i as HTMLInputElement).disabled)).toBe(true);
    expect(find('Large').hasAttribute('disabled')).toBe(true);
  });
});

describe('ZoomEdit', () => {
  it('sets focus and feel on the selected zoom', () => {
    render(withZooms(), 'zoom');
    act(() => find('Follow cursor').click());
    expect(zooms()[0]!.focus).toBe('cursor');
    act(() => find('Fixed spot').click());
    expect(zooms()[0]!.focus).toEqual({ x: 0.3, y: 0.3 });
    act(() => find('Snappy').click());
    expect(zooms()[0]!.feel).toBe('snappy');
    expect(lastLabel()).toBe('Changed the zoom at 00:01');
  });

  it('lists every zoom with why, and removes all as one step', () => {
    render(withZooms(), 'zoom');
    expect(host.querySelector('[aria-label="All zooms"]')!.textContent).toContain('2 clicks');
    expect(toggle('Motion blur').disabled).toBe(true);
    act(() => find('Remove all 2').click());
    expect(zooms()).toEqual([]);
    expect(lastLabel()).toBe('Removed 2 zooms');
  });

  it('marks auto zooms in the header', () => {
    expect(zoomPlace(2, 6, { auto: true } as never)).toBe('2 of 6 · auto');
    expect(zoomPlace(1, 1, { auto: false } as never)).toBe('1 of 1');
  });
});

describe('AutoZoomOnOpen', () => {
  it('adds zooms on the clicks once, as one step', () => {
    render(v3(), 'open');
    expect(zooms().map((z) => z.why)).toEqual(['2 clicks', 'Click']);
    expect(steps(latest).steps.map((s) => s.label)).toEqual(['Added 2 zooms']);
  });

  it('leaves a recording without events alone', () => {
    const start = fromRecording(recording);
    render(start, 'open');
    expect(latest).toBe(start);
  });
});

describe('FocusStage', () => {
  const stage = () => {
    const el = host.querySelector<HTMLElement>('[data-testid="focus-stage"]');
    if (el) el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 192, height: 108 }) as DOMRect;
    return el;
  };
  const ring = () => host.querySelector<HTMLElement>('[aria-label="Focus"]');
  const pointer = (type: string, x: number, y: number) => act(() => { stage()!.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y })); });
  const focusOf = (c: Cut) => c.zooms[0]!.focus;

  it('shows the Focus ring only for a selected fixed-spot zoom', () => {
    render(withZooms(), 'stage');
    expect(stage()).toBeNull();
    act(() => select({ kind: 'zooms', ids: [zooms()[1]!.id] }));
    expect(stage()).toBeNull();
    act(() => select({ kind: 'zooms', ids: [zooms()[0]!.id] }));
    expect(ring()!.textContent).toBe('Focus');
    expect(ring()!.style.left).toBe('30%');
  });

  it('places on click, previews live while dragging and makes one step on release', () => {
    render(withZooms(), 'stage');
    act(() => select({ kind: 'zooms', ids: [zooms()[0]!.id] }));
    const before = steps(latest).steps.length;
    pointer('pointerdown', 96, 27);
    expect(focusOf(preview.mock.calls.at(-1)![0])).toEqual({ x: 0.5, y: 0.25 });
    pointer('pointermove', 48, 54);
    expect(focusOf(preview.mock.calls.at(-1)![0])).toEqual({ x: 0.25, y: 0.5 });
    expect(ring()!.style.left).toBe('25%');
    expect(zooms()[0]!.focus).toEqual({ x: 0.3, y: 0.3 });
    pointer('pointerup', 48, 54);
    expect(preview.mock.calls.at(-1)![0]).toBeNull();
    expect(zooms()[0]!.focus).toEqual({ x: 0.25, y: 0.5 });
    expect(steps(latest).steps).toHaveLength(before + 1);
    expect(lastLabel()).toBe('Changed the zoom at 00:01');
  });

  it('cannot be moved while read-only', () => {
    const start = withZooms();
    render(start, 'stage', true);
    act(() => select({ kind: 'zooms', ids: [currentCut(start).zooms[0]!.id] }));
    pointer('pointerdown', 96, 27);
    pointer('pointerup', 96, 27);
    expect(preview).not.toHaveBeenCalled();
    expect(latest).toBe(start);
  });
});
