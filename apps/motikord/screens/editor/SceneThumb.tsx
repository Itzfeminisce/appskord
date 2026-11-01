import { useEffect, useRef } from 'react';
import { drawFrame } from '../../lib/render/drawFrame';
import type { Aspect, Recipe } from '../../lib/types';
import { useEditor } from './Editor';

/** One still frame of a recipe (template cards, Changes thumbnails, All sizes); it redraws only when its inputs change. */
export function SceneThumb({ recipe, aspect, timeMs, w, h, label }: { recipe: Recipe; aspect: Aspect; timeMs: number; w: number; h: number; label?: string }) {
  const { cache } = useEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }, [w, h]);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    try { drawFrame(ctx, recipe, aspect, timeMs, cache); } catch (error) { console.error('Motikord: could not draw a thumbnail', error); }
  }, [recipe, aspect, timeMs, w, h, cache]);
  return <canvas ref={ref} aria-label={label} aria-hidden={label ? undefined : true} style={{ width: w, height: h, display: 'block', borderRadius: 6, background: 'var(--stage)', flexShrink: 0 }} />;
}

/** Thumbnail box for an aspect at a given height. */
export const thumbSize = (aspect: Aspect, h: number) => ({ w: Math.round(h * (aspect === '16:9' ? 16 / 9 : aspect === '1:1' ? 1 : 9 / 16)), h });
