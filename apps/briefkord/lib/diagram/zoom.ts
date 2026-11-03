/** The diagram editor's zoom: 25% to 400%, kept for the open view only. */
import type { Diagram } from '../board/types';

export const DIAGRAM_ZOOM = { min: 0.25, max: 4 };
export const ZOOM_STEP = 1.25;
/** The most one wheel event zooms: one mouse notch is about 12%, while a pinch's small steps stay smooth. */
export const WHEEL_STEP = 1.12;

export interface View { x: number; y: number; zoom: number }
export interface Area { w: number; h: number }
/** Room the editor keeps clear: the selection bar above and the hint and zoom control below. */
export interface Margin { x: number; top: number; bottom: number }
export const VIEW_MARGIN: Margin = { x: 48, top: 72, bottom: 72 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The zoom factor for a Ctrl + wheel event that scrolled `pixels` down. */
export const wheelZoom = (pixels: number): number => clamp(Math.exp(-pixels * 0.01), 1 / WHEEL_STEP, WHEEL_STEP);

export function diagramBox(diagram: Diagram): { x: number; y: number; w: number; h: number } | undefined {
  if (diagram.nodes.length === 0) return undefined;
  const x = Math.min(...diagram.nodes.map((n) => n.x)), y = Math.min(...diagram.nodes.map((n) => n.y));
  return { x, y, w: Math.max(...diagram.nodes.map((n) => n.x + n.w)) - x, h: Math.max(...diagram.nodes.map((n) => n.y + n.h)) - y };
}

/** The view that centres the diagram at `zoom` (clamped). */
function centred(diagram: Diagram, area: Area, zoom: number, m: Margin): View {
  const box = diagramBox(diagram);
  const z = clamp(zoom, DIAGRAM_ZOOM.min, DIAGRAM_ZOOM.max);
  if (!box) return { x: area.w / 2, y: area.h / 2, zoom: z };
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return { x: area.w / 2 - cx * z, y: m.top + (area.h - m.top - m.bottom) / 2 - cy * z, zoom: z };
}

/** The zoom at which the whole diagram fits the area, inside the margins. */
export function fitZoom(diagram: Diagram, area: Area, m = VIEW_MARGIN): number {
  const box = diagramBox(diagram);
  if (!box) return 1;
  return clamp(Math.min((area.w - 2 * m.x) / Math.max(box.w, 1), (area.h - m.top - m.bottom) / Math.max(box.h, 1)), DIAGRAM_ZOOM.min, DIAGRAM_ZOOM.max);
}

/** Fit: the whole diagram in view, centred. */
export function fitView(diagram: Diagram, area: Area, m = VIEW_MARGIN): View {
  return centred(diagram, area, fitZoom(diagram, area, m), m);
}

/** The view the editor opens at: Fit, but a small diagram is not blown up past 100%. */
export function openView(diagram: Diagram, area: Area, m = VIEW_MARGIN): View {
  return centred(diagram, area, Math.min(1, fitZoom(diagram, area, m)), m);
}

/** Zooms to `zoom` (clamped), keeping the diagram point under `at` (area pixels) still. */
export function zoomTo(view: View, at: { x: number; y: number }, zoom: number): View {
  const z = clamp(zoom, DIAGRAM_ZOOM.min, DIAGRAM_ZOOM.max);
  const wx = (at.x - view.x) / view.zoom, wy = (at.y - view.y) / view.zoom;
  return { x: at.x - wx * z, y: at.y - wy * z, zoom: z };
}

/** Area pixels to diagram units. */
export const toDiagram = (view: View, p: { x: number; y: number }) => ({ x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom });
