import { useEffect, useRef, type CSSProperties } from 'react';
import { drawFrame } from '../lib/render/drawFrame';
import { MediaCache } from '../lib/render/cache';
import { estimateFor, wrap, type Measure } from '../lib/render/textFit';
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

// Words a cut line should not end on: "Choose a…" reads as broken.
const DANGLING = /^(a|an|the|and|or|of|to|for|with|in|on|at|by|your|our|my|&)$/i;

/** Ends a line on a whole word and "…" so it fits `width`; a lone word that can't fit keeps its "…" and is clipped. */
function cutLine(line: string, width: number, size: number, m: Measure): string {
  const words = line.split(' ');
  for (let n = words.length; n > 0; n--) {
    const keep = words.slice(0, n);
    if (n > 1 && DANGLING.test(keep.at(-1)!)) continue;
    if (m(`${keep.join(' ')}…`, size) <= width) return `${keep.join(' ')}…`;
  }
  return `${words[0]}…`;
}

/**
 * Whole-word lines for a small preview. The size shrinks (not below `minSize`) until the longest word fits `width`, or the
 * whole text when `maxLines` is 1; it wraps only at spaces; past `maxLines` the last line ends on a whole word and "…".
 */
export function previewLines(text: string, o: { width: number; size: number; minSize?: number; maxLines: number; measure: Measure; upper?: boolean }): { size: number; lines: string[] } {
  const m: Measure = o.upper ? (t, px) => o.measure(t.toUpperCase(), px) : o.measure;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return { size: o.size, lines: [] };
  const widest = o.maxLines === 1 ? m(words.join(' '), 1) : Math.max(...words.map((w) => m(w, 1)));
  const size = Math.max(Math.min(o.minSize ?? 0, o.size), Math.min(o.size, o.width / widest));
  const all = wrap(words.join(' '), o.width, size, m);
  if (all.length <= o.maxLines) return { size, lines: all };
  const lines = all.slice(0, o.maxLines);
  lines[lines.length - 1] = cutLine(lines.at(-1)!, o.width, size, m);
  return { size, lines };
}

// Glyph widths are estimates; keep a little room so a line never grazes the card edge.
const ROOM = 0.94;
const asLines = (lines: string[]) => lines.map((l, i) => <span key={i} style={{ display: 'block', whiteSpace: 'nowrap' }}>{l}</span>);

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
  const inner = (width - 18 * u) * ROOM;
  const kicker = p.kicker && !compact ? previewLines(p.kicker, { width: inner, size: 7 * u, minSize: 6 * u, maxLines: 1, upper: true, measure: estimateFor(textFont, 0.08) }) : undefined;
  const head = p.headline ? previewLines(p.headline, { width: inner, size: (compact ? 13 : 15) * u, maxLines: p.items.length ? 2 : compact ? 3 : 4, upper: bold, measure: estimateFor(display, -0.01) }) : undefined;
  const line = p.line && !p.items.length && !compact ? previewLines(p.line, { width: inner, size: 9 * u, minSize: 8 * u, maxLines: 3, measure: estimateFor(textFont) }) : undefined;
  const itemW = inner - mark - 6 * u;
  const items = compact ? [] : p.items.map((it) => previewLines(it, { width: itemW, size: 10 * u, minSize: 7 * u, maxLines: 1, measure: estimateFor(textFont) }));
  const markOn = accent;
  return (
    <span aria-hidden="true" style={{ width, height, position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 * u, padding: `${14 * u}px ${9 * u}px ${(band ? bandH : 0) + 8 * u}px`, boxSizing: 'border-box', overflow: 'hidden', background: p.media ? `linear-gradient(180deg, ${mixHex(accent, bg, 0.75)} 0%, ${bg} 70%)` : bg, justifyContent: p.media && !p.items.length ? 'flex-end' : 'flex-start', ...style }}>
      {kicker && <span style={{ fontFamily: `"${textFont}", sans-serif`, fontSize: kicker.size, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent, lineHeight: 1.2, overflow: 'hidden' }}>{asLines(kicker.lines)}</span>}
      {head && <span style={{ fontFamily: `"${display}", sans-serif`, fontWeight: title?.weight ?? 800, fontSize: head.size, lineHeight: 0.98, letterSpacing: '-0.01em', textTransform: bold ? 'uppercase' : undefined, color: ink, overflow: 'hidden' }}>{asLines(head.lines)}</span>}
      {line && <span style={{ fontFamily: `"${textFont}", sans-serif`, fontSize: line.size, lineHeight: 1.25, color: ink, opacity: 0.8, overflow: 'hidden' }}>{asLines(line.lines)}</span>}
      {p.items.length > 0 && (
        <span style={{ marginTop: 6 * u, display: 'flex', flexDirection: 'column', gap: (compact ? 5 : 9) * u }}>
          {p.items.map((it, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 * u, minWidth: 0 }}>
              <span style={{ width: compact ? 6 * u * 2 : mark, height: compact ? 6 * u * 2 : mark, flexShrink: 0, borderRadius: p.numbered || compact ? '50%' : 0, background: markOn, color: bg, display: 'grid', placeItems: 'center', fontFamily: `"${display}", sans-serif`, fontSize: 9 * u, lineHeight: 1 }}>
                {compact ? null : p.numbered ? i + 1 : <svg width={8 * u} height={8 * u} viewBox="0 0 24 24" fill="none" stroke={bg} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
              </span>
              {compact ? <span style={{ height: Math.max(2, 2 * u * 2), width: `${Math.min(80, 30 + it.length * 4)}%`, background: ink, borderRadius: 1 }} /> : <span style={{ fontFamily: `"${textFont}", sans-serif`, fontSize: items[i]!.size, lineHeight: 1.1, color: ink, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{items[i]!.lines[0]}</span>}
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
  const text = t.slots.find((d) => d.kind === 'text' && d.id !== 'kicker') ?? t.slots.find((d) => d.kind === 'text');
  const list = t.slots.find((d) => d.kind === 'items');
  const slots: Record<string, string | string[]> = {};
  if (list) {
    if (text && title) slots[text.id] = title;
    slots[list.id] = beat.line.split(/,| and /).map((s) => s.trim()).filter(Boolean).slice(0, 4).map((s) => s[0]!.toUpperCase() + s.slice(1));
  } else if (text) slots[text.id] = beat.line;
  const scene = expandScene({ id: 'preview', durationMs: beat.ms, background: pack.palette.bg, layout: 'center', layers: [], template: beat.template, slots }, pack);
  return { version: 2, id: 'preview', name: '', type: 'social', aspect, scenes: [scene], assets: {}, style };
}
