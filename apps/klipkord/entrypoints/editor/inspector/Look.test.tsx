// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentCut, steps } from '@/lib/project/history';
import { fromRecording } from '@/lib/project/migrate';
import { addLayer } from '@/lib/project/ops';
import { cutLength } from '@/lib/project/time';
import type { Project, RecEvent } from '@/lib/project/types';
import type { Recording } from '@/lib/types';
import type { SlotProps } from '../components/slots';
import { LookPanel, paddingText, shadowText } from './Look';
import { AutoZoomOnOpen, ZoomEdit, zoomPlace } from './ZoomEdit';

const events: RecEvent[] = [{ t: 2000, type: 'click', x: 0.3, y: 0.3 }, { t: 2300, type: 'click', x: 0.31, y: 0.3 }, { t: 8000, type: 'click', x: 0.8, y: 0.8 }];
vi.mock('../transcript/events', () => ({ useEvents: (p: Project) => (p.events ? events : []) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recording = { id: 'r', title: 'Invite', createdAt: 1, duration: 20_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], transcriptPending: false } as unknown as Recording;
let root: Root;
let host: HTMLElement;
let latest: Project;

type Panel = 'look' | 'zoom' | 'open';
function Harness({ start, panel, readOnly = false }: { start: Project; panel: Panel; readOnly?: boolean }) {
  const [project, setProject] = useState(start);
  latest = project;
  const cut = currentCut(project);
  const edit = (op: (p: Project) => Project) => setProject((p) => op(p));
  const p: SlotProps = { recording, project, cut, out: 0, length: cutLength(cut), playing: false, ready: true, readOnly, seek: () => {}, play: () => {}, edit };
  if (panel === 'open') return <AutoZoomOnOpen {...p} />;
  if (panel === 'zoom') return cut.zooms[0] ? <ZoomEdit p={p} zoom={cut.zooms[0]} /> : null;
  return <LookPanel {...p} />;
}
const render = (start: Project, panel: Panel, readOnly = false) => act(() => root.render(<Harness start={start} panel={panel} readOnly={readOnly} />));
const find = (name: string) => [...host.querySelectorAll<HTMLElement>('button, [role="switch"]')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name)!;
const toggle = (name: string) => [...host.querySelectorAll('label')].find((l) => l.textContent?.startsWith(name))!.querySelector('input')!;
const lastLabel = () => steps(latest).steps.at(-1)?.label;
const look = () => currentCut(latest).look;
const zooms = () => currentCut(latest).zooms;
const v3 = (): Project => ({ ...fromRecording(recording), events: true });
const withZooms = () => addLayer(v3(), { kind: 'zooms', items: [
  { at: 1000, end: 4000, depth: 1.6, focus: { x: 0.3, y: 0.3 }, feel: 'smooth', auto: true, why: '2 clicks' },
  { at: 7000, end: 9000, depth: 2, focus: 'cursor', feel: 'smooth', auto: false },
] });

beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

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
    expect(look().background).toEqual({ kind: 'colour', value: '#1C1917' });
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
    expect(paddingText(76)).toBe('7%');
    expect([shadowText(24), shadowText(0)]).toEqual(['Soft', '0 px']);
  });

  it('changes nothing while read-only', () => {
    const start = fromRecording(recording);
    render(start, 'look', true);
    act(() => find('Gradient').click());
    expect(latest).toBe(start);
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
