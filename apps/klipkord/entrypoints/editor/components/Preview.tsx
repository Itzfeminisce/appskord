import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Caption } from '@/lib/project/captions';
import type { Cut, EventsTrack, Project } from '@/lib/project/types';
import { FRAME, renderPlan } from '@/lib/render/plan';
import type { RenderSource } from '@/lib/render/render.worker';
import { useDeps } from '../deps';
import type { PreviewClient } from '../preview';
import { C } from '../ui';

/** Light preview draws at this share of the preview's pixels. */
export const LIGHT_SCALE = 0.5;
/** preview-slow: fewer frames than this per second while playing, for two seconds running. */
export const SLOW_FPS = 15;

export interface PreviewProps {
  project: Project;
  cut: Cut;
  out: number;
  playing: boolean;
  /** Null until the files are open; the steps show meanwhile. */
  sources: RenderSource[] | null;
  events?: EventsTrack;
  captions?: Caption[];
  light: boolean;
  /** EditorOpening's steps (and opening-slow) until the first frame shows. */
  opening: ReactNode;
  firstFrame: boolean;
  onFirstFrame(): void;
  onSlow(): void;
  stageRef: RefObject<HTMLDivElement | null>;
  /** Drawn over the picture, in its box. */
  children?: ReactNode;
}

/** A canvas goes to the worker only once, so its client outlives an effect re-run (StrictMode) and closes on unmount. */
const clients = new WeakMap<HTMLCanvasElement, { client: PreviewClient; closing?: ReturnType<typeof setTimeout> }>();

const fitBox = (aspect: number, w: number, h: number) => (w / h > aspect ? { w: Math.round(h * aspect), h: Math.round(h) } : { w: Math.round(w), h: Math.round(w / aspect) });

/** The video at preview size, drawn by the render worker from the same plan export uses. */
export function Preview(p: PreviewProps) {
  const deps = useDeps();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const client = useRef<PreviewClient | null>(null);
  const [area, setArea] = useState({ w: 533, h: 300 });
  const frame = FRAME[p.cut.shape];
  // The stage's content box already leaves out its top padding; 12 px stays clear on each side.
  const box = fitBox(frame.w / frame.h, Math.max(1, area.w - 24), Math.max(1, area.h));
  const firstFrame = useRef(p.onFirstFrame);
  firstFrame.current = p.onFirstFrame;
  const slow = useRef(p.onSlow);
  slow.current = p.onSlow;
  const playing = useRef(p.playing);
  playing.current = p.playing;

  useEffect(() => {
    const stage = p.stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setArea({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [p.stageRef]);

  // The canvas goes to the worker once, when the files are open.
  const ready = p.sources !== null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas || client.current) return;
    let entry = clients.get(canvas);
    if (entry) clearTimeout(entry.closing);
    else {
      const made = deps.startPreview(canvas, p.sources ?? []);
      if (!made) return;
      entry = { client: made };
      clients.set(canvas, entry);
    }
    const kept = entry;
    const c = kept.client;
    client.current = c;
    let shown = false;
    let drawn: number[] = [];
    let slowSeconds = 0;
    let lastCheck = performance.now();
    const off = c.onDrawn((ok) => {
      const now = performance.now();
      if (ok && !shown) {
        shown = true;
        firstFrame.current();
      }
      if (ok) drawn.push(now);
      if (now - lastCheck < 1000) return;
      drawn = drawn.filter((t) => now - t < 1000);
      slowSeconds = playing.current && drawn.length < SLOW_FPS ? slowSeconds + 1 : 0;
      lastCheck = now;
      if (slowSeconds >= 2) slow.current();
    });
    return () => {
      off();
      client.current = null;
      kept.closing = setTimeout(() => {
        clients.delete(canvas);
        c.close();
      }, 0);
    };
  }, [ready, deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (p.sources) client.current?.addSources(p.sources);
  }, [p.sources]);

  useEffect(() => {
    const scale = (p.light ? LIGHT_SCALE : 1) * (globalThis.devicePixelRatio || 1);
    client.current?.resize(Math.max(1, Math.round(box.w * scale)), Math.max(1, Math.round(box.h * scale)));
  }, [box.w, box.h, p.light, ready]);

  useEffect(() => {
    client.current?.render(renderPlan(p.project, p.cut, p.out, p.events, p.captions), p.cut.shape);
  }, [p.project, p.cut, p.out, p.events, p.captions, ready, box.w, box.h, p.light]);

  return (
    <div ref={p.stageRef} style={{ flexGrow: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', paddingTop: 8 }}>
      <div style={{ width: box.w, height: box.h, position: 'relative', borderRadius: 6, overflow: 'hidden', background: p.firstFrame ? '#000000' : C.raised }}>
        <canvas ref={canvasRef} aria-label="Preview" style={{ width: '100%', height: '100%', display: 'block', visibility: p.firstFrame ? 'visible' : 'hidden' }} />
        {!p.firstFrame && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.opening}</div>
        )}
        {p.firstFrame && p.children}
      </div>
    </div>
  );
}
