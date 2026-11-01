import { useEffect, useRef, type CSSProperties } from 'react';
import { drawFrame } from '../lib/render/drawFrame';
import { MediaCache } from '../lib/render/cache';
import { expandScene } from '../lib/templates/expand';
import { getPack, getSceneTemplate } from '../lib/templates/scenes';
import type { Aspect, Beat, Recipe, StyleId } from '../lib/types';

/** A style pack's colour chip: its ground with the accent band along the bottom. */
export function PackSwatch({ style, w = 14, h = 20, radius = 3 }: { style: StyleId | undefined; w?: number; h?: number; radius?: number }) {
  const p = style ? getPack(style)?.palette : undefined;
  if (!p) return null;
  const light = p.bg.toUpperCase() === '#FFFFFF' || p.bg.toUpperCase() === '#FFF7ED';
  return (
    <span aria-hidden="true" style={{ width: w, height: h, borderRadius: radius, background: p.bg, display: 'flex', alignItems: 'flex-end', flexShrink: 0, overflow: 'hidden', boxShadow: light ? 'inset 0 0 0 1px var(--line)' : undefined }}>
      <span style={{ width: '100%', height: Math.round(h * 0.34), background: p.accent }} />
    </span>
  );
}

const ratio = (a: Aspect) => (a === '9:16' ? 9 / 16 : a === '1:1' ? 1 : 16 / 9);

/** One scene of a recipe drawn small, at `atMs` into the scene. */
export function SceneThumb({ recipe, index, width, height, atMs = 2400, style }: { recipe: Recipe; index: number; width: number; height: number; atMs?: number; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = recipe.scenes[index];
  const r = ratio(recipe.aspect);
  const w = Math.min(width, Math.round(height * r));
  const h = Math.round(w / r);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !scene) return;
    let live = true;
    const draw = () => {
      if (!live) return;
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = w * 2;
        canvas.height = h * 2;
        const start = recipe.scenes.slice(0, index).reduce((t, s) => t + s.durationMs, 0);
        drawFrame(ctx, recipe, recipe.aspect, start + Math.min(atMs, scene.durationMs - 1), new MediaCache());
      } catch (error) {
        console.error('Motikord: could not draw a scene preview', error);
      }
    };
    draw();
    // The pack's fonts load on first use; draw again once they are in.
    const fonts = [...new Set(scene.layers.flatMap((l) => ('font' in l && l.font ? [`${'weight' in l ? l.weight : 400} 16px "${l.font}"`] : [])))];
    if (typeof document !== 'undefined' && document.fonts && fonts.length) void Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => []))).then(draw);
    return () => { live = false; };
  }, [recipe, index, w, h, atMs, scene]);
  return (
    <span style={{ width, height, display: 'grid', placeItems: 'center', overflow: 'hidden', background: scene?.background ?? 'var(--stage)', ...style }}>
      <canvas ref={ref} aria-hidden="true" style={{ width: w, height: h, display: 'block' }} />
    </span>
  );
}

/** A one-scene recipe from a planned beat in its pack, so the scene being filled can be shown before its words come back. */
export function beatPreview(beat: Beat, style: StyleId, aspect: Aspect = '9:16', title?: string): Recipe | undefined {
  const t = getSceneTemplate(beat.template);
  const pack = getPack(style);
  if (!t || !pack) return undefined;
  const text = t.slots.find((d) => d.kind === 'text');
  const list = t.slots.find((d) => d.kind === 'items');
  const slots: Record<string, string | string[]> = {};
  if (list) {
    if (text && title) slots[text.id] = title;
    slots[list.id] = beat.line.split(/,| and /).map((s) => s.trim()).filter(Boolean).slice(0, 4).map((s) => s[0]!.toUpperCase() + s.slice(1));
  } else if (text) slots[text.id] = beat.line;
  const scene = expandScene({ id: 'preview', durationMs: beat.ms, background: pack.palette.bg, layout: 'center', layers: [], template: beat.template, slots }, pack);
  return { version: 2, id: 'preview', name: '', type: 'social', aspect, scenes: [scene], assets: {}, style };
}
