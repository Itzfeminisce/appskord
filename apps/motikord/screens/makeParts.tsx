import { useEffect, useRef, type CSSProperties } from 'react';
import { drawFrame } from '../lib/render/drawFrame';
import { MediaCache } from '../lib/render/cache';
import { expandScene } from '../lib/templates/expand';
import { getPack, getSceneTemplate } from '../lib/templates/scenes';
import type { Aspect, Beat, Recipe, Scene, StyleId, TextLayer } from '../lib/types';

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

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'label' in x ? String((x as { label: unknown }).label) : '')).filter(Boolean) : []);

/** The words a preview card shows for one scene: a kicker, a headline, a line or items, and the clip's handle. */
export function previewParts(recipe: Recipe, scene: Scene) {
  const t = scene.template ? getSceneTemplate(scene.template) : undefined;
  const slots = scene.slots ?? {};
  const texts = (t?.slots ?? []).filter((d) => d.kind === 'text').map((d) => ({ d, v: str(slots[d.id]) })).filter((x) => x.v);
  const head = texts.find((x) => x.d.scale === 'display' || x.d.scale === 'headline' || x.d.scale === 'number') ?? texts.find((x) => x.d.scale !== 'caption');
  const kicker = texts.find((x) => x !== head && (x.d.scale === 'caption' || x.d.id === 'kicker'));
  const line = texts.find((x) => x !== head && x !== kicker);
  const itemsDef = t?.slots.find((d) => d.kind === 'items' || d.kind === 'chart');
  const handle = recipe.scenes.map((s) => str(s.slots?.handle)).find(Boolean);
  return {
    kicker: kicker?.v ?? (t ? t.name : undefined),
    headline: head?.v ?? scene.layers.find((l): l is TextLayer => l.type === 'text')?.text,
    line: line?.v,
    items: itemsDef ? list(slots[itemsDef.id]).slice(0, 4) : [],
    numbered: scene.template === 'steps',
    media: (t?.slots ?? []).some((d) => d.kind === 'media'),
    handle,
  };
}

/** One scene drawn as a readable card at preview size: small kicker, heavy headline, marked items and the accent footer band. */
export function ScenePreview({ recipe, index, width, height, style }: { recipe: Recipe; index: number; width: number; height: number; style?: CSSProperties }) {
  const scene = recipe.scenes[index];
  const pack = recipe.style ? getPack(recipe.style) : undefined;
  if (!scene || !scene.template || !pack) return <SceneThumb recipe={recipe} index={index} width={width} height={height} style={style} />;
  const p = previewParts(recipe, scene);
  const title = scene.layers.find((l): l is TextLayer => l.type === 'text' && l.role === 'title');
  const body = scene.layers.find((l): l is TextLayer => l.type === 'text' && l.role !== 'title');
  const bg = scene.bg?.colours[0] ?? scene.background ?? pack.palette.bg;
  const ink = title?.colour ?? pack.palette.ink;
  const accent = pack.palette.accent;
  const display = title?.font ?? pack.fonts.display;
  const textFont = body?.font ?? pack.fonts.text;
  const bold = pack.id === 'bold';
  const compact = width < 64;
  const u = width / 96;
  const band = pack.background.kind === 'blocks';
  const bandH = Math.round((compact ? 6 : 22) * u);
  const mark = Math.round((p.numbered ? 16 : 12) * u);
  const clamp = (lines: number): CSSProperties => ({ display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' });
  const markOn = accent;
  return (
    <span aria-hidden="true" style={{ width, height, position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 * u, padding: `${14 * u}px ${9 * u}px ${(band ? bandH : 0) + 8 * u}px`, boxSizing: 'border-box', overflow: 'hidden', background: p.media ? `linear-gradient(180deg, ${mixHex(accent, bg, 0.75)} 0%, ${bg} 70%)` : bg, justifyContent: p.media && !p.items.length ? 'flex-end' : 'flex-start', ...style }}>
      {p.kicker && !compact && <span style={{ fontFamily: `"${textFont}", sans-serif`, fontSize: 7 * u, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, lineHeight: 1.2, ...clamp(1) }}>{p.kicker}</span>}
      {p.headline && <span style={{ fontFamily: `"${display}", sans-serif`, fontWeight: title?.weight ?? 800, fontSize: (compact ? 13 : 15) * u, lineHeight: 0.98, letterSpacing: '-0.01em', textTransform: bold ? 'uppercase' : undefined, color: ink, ...clamp(p.items.length ? 2 : 4) }}>{p.headline}</span>}
      {p.line && !p.items.length && !compact && <span style={{ fontFamily: `"${textFont}", sans-serif`, fontSize: 9 * u, lineHeight: 1.25, color: ink, opacity: 0.8, ...clamp(3) }}>{p.line}</span>}
      {p.items.length > 0 && (
        <span style={{ marginTop: 6 * u, display: 'flex', flexDirection: 'column', gap: (compact ? 5 : 9) * u }}>
          {p.items.map((it, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 * u, minWidth: 0 }}>
              <span style={{ width: compact ? 6 * u * 2 : mark, height: compact ? 6 * u * 2 : mark, flexShrink: 0, borderRadius: p.numbered || compact ? '50%' : 0, background: markOn, color: bg, display: 'grid', placeItems: 'center', fontFamily: `"${display}", sans-serif`, fontSize: 9 * u, lineHeight: 1 }}>
                {compact ? null : p.numbered ? i + 1 : <svg width={8 * u} height={8 * u} viewBox="0 0 24 24" fill="none" stroke={bg} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </span>
              {compact ? <span style={{ height: Math.max(2, 2 * u * 2), width: `${Math.min(80, 30 + it.length * 4)}%`, background: ink, borderRadius: 1 }} /> : <span style={{ fontFamily: `"${textFont}", sans-serif`, fontSize: 10 * u, lineHeight: 1.1, color: ink, minWidth: 0, ...clamp(1) }}>{it}</span>}
            </span>
          ))}
        </span>
      )}
      {band && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: bandH, background: accent, padding: `0 ${9 * u}px`, display: 'flex', alignItems: 'center', fontFamily: `"${textFont}", sans-serif`, fontSize: 8 * u, color: bg, overflow: 'hidden', whiteSpace: 'nowrap' }}>{compact ? null : p.handle}</span>}
    </span>
  );
}

const mixHex = (a: string, b: string, t: number): string => {
  const ok = (h: string) => /^#[0-9a-f]{6}$/i.test(h);
  if (!ok(a) || !ok(b)) return b;
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0')).join('')}`;
};

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
