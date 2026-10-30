import { creditsList, endCardLines, needsCreditsFile } from './credits';
import { clipDuration } from './render/drawFrame';
import { canvasSize, qualityShort } from './render/reflow';
import { KIND_LABEL, videoFileName } from './fileNames';
import { EXPORT, GIF } from './check/plan';
import type { Aspect, Box, FileKind, Quality, Recipe, Scene, TextLayer } from './types';

export const FPS = EXPORT.fps;
export const END_CARD_MS = 2000;
// T0: GIFs render at 15 fps with a 480 px long side, which keeps them small enough for chats.
export const GIF_FPS = GIF.fps;
export const GIF_LONG = GIF.width;
export const ASPECTS: readonly Aspect[] = ['9:16', '1:1', '16:9'];

export interface ExportChoice { kinds: FileKind[]; aspects: Aspect[]; quality: Quality }

/** The credits.txt box: ticked and locked when any asset is CC BY; otherwise ticked when anything is credited, and the person's to change. */
export function creditsBox(r: Recipe, wanted?: boolean): { locked: boolean; on: boolean } {
  if (needsCreditsFile(r)) return { locked: true, on: true };
  return { locked: false, on: wanted ?? creditsList(r).credited.length > 0 };
}

/** One file the export makes. */
export interface RenderItem {
  aspect: Aspect; kind: FileKind; quality: Quality; file: string; label: string;
  width: number; height: number; fps: number; frames: number; durationMs: number;
  audio: boolean; seeThrough: boolean; bitrate: number;
}

/** Pixel size of one file: 720p or 1080p on the short side; GIFs stay small. */
export function frameSize(aspect: Aspect, kind: FileKind, quality: Quality): { w: number; h: number } {
  if (kind !== 'gif') return canvasSize(aspect, qualityShort(quality));
  const long = canvasSize(aspect, 1000);
  const k = GIF_LONG / Math.max(long.w, long.h);
  const even = (v: number) => Math.max(2, Math.round((v * k) / 2) * 2);
  return { w: even(long.w), h: even(long.h) };
}

/** True when the clip has sound to mix: music, or a video layer that is not muted. */
export function hasAudio(r: Recipe): boolean {
  if (r.music && r.assets[r.music.assetId]) return true;
  return r.scenes.some((s) => s.layers.some((l) => l.type === 'video' && !l.muted));
}

/** Every file, sizes inside kinds, in the order they render one after another. */
export function planExport(r: Recipe, choice: ExportChoice): RenderItem[] {
  const durationMs = clipDuration(r) + (r.creditsEndCard && endCardLines(r).length ? END_CARD_MS : 0);
  const sound = hasAudio(r);
  const items: RenderItem[] = [];
  for (const kind of choice.kinds) for (const aspect of choice.aspects) {
    const { w, h } = frameSize(aspect, kind, choice.quality);
    const fps = kind === 'gif' ? GIF_FPS : FPS;
    items.push({
      aspect, kind, quality: choice.quality, file: videoFileName(r.name, aspect, kind),
      label: `${aspect} · ${KIND_LABEL[kind]} · ${choice.quality}`,
      width: w, height: h, fps, frames: Math.max(1, Math.ceil((durationMs / 1000) * fps)), durationMs,
      audio: sound && kind !== 'gif', seeThrough: kind === 'webm-alpha',
      bitrate: Math.round(8_000_000 * ((w * h) / (1920 * 1080)) ** 0.75),
    });
  }
  return items;
}

/** The credits end card, drawn by the renderer like any scene: frame copy from Credits (End card). */
export function endCardScene(r: Recipe): Scene | undefined {
  const lines = endCardLines(r);
  if (!lines.length) return undefined;
  const boxes = (which: 'head' | 'body'): Partial<Record<Aspect, Box>> => Object.fromEntries(ASPECTS.map((a) => {
    const { w: W, h: H } = canvasSize(a, 1080);
    const pad = 0.09 * Math.min(W, H);
    const headH = 90 * 1.3;
    if (which === 'head') return [a, { x: pad / W, y: pad / H, w: 1 - (2 * pad) / W, h: headH / H }];
    const top = pad + headH + 40;
    // Each credit wraps to about chars × half an em; boxes this tall keep the block near the top like the frame.
    const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil((l.length * 72 * 0.5) / (W - 2 * pad))), 0);
    const h = Math.min(H - top - pad, rows * 72 * 1.5 + 20);
    return [a, { x: pad / W, y: top / H, w: 1 - (2 * pad) / W, h: h / H }];
  }));
  const text = (id: string, role: TextLayer['role'], t: string, sizePx: number, weight: number, colour: string, b: Partial<Record<Aspect, Box>>): TextLayer => ({
    id, name: id, type: 'text', role, text: t, font: 'Geist', sizePx, weight, colour, align: 'left', lineHeight: role === 'title' ? 1.2 : 1.5,
    startMs: 0, endMs: END_CARD_MS, opacity: 1, box: b[r.aspect]!, boxes: b,
  });
  return {
    id: 'credits-end-card', durationMs: END_CARD_MS, background: '#111114', layout: 'full',
    layers: [text('end-card-title', 'title', 'Credits', 90, 600, '#FFFFFF', boxes('head')), text('end-card-lines', 'body', lines.join('\n'), 72, 400, '#E4E4E7', boxes('body'))],
  };
}

/** The recipe the worker draws: the clip plus, when asked for, the 2 s end card. Never written back. */
export function exportRecipe(r: Recipe): Recipe {
  const card = r.creditsEndCard ? endCardScene(r) : undefined;
  return card ? { ...r, scenes: [...r.scenes, card] } : r;
}

// T0 budget: a 15 s 1080p30 clip in about 30 s; smaller frames cost less. GIF took about 0.4 s per clip second.
export function estimateSeconds(items: RenderItem[]): number {
  return items.reduce((sum, it) => {
    const secs = it.durationMs / 1000;
    if (it.kind === 'gif') return sum + secs * 0.4;
    const perSecond = (EXPORT.budgetSeconds / EXPORT.seconds) * ((it.width * it.height) / (EXPORT.width * EXPORT.height));
    return sum + secs * Math.max(0.5, perSecond) * (it.seeThrough ? 1.3 : 1);
  }, 0);
}

/** "About 30 seconds" / "About 2 minutes": rounded up so the guess is not too hopeful. */
export function about(seconds: number): string {
  if (seconds < 60) {
    const s = seconds <= 10 ? Math.max(1, Math.ceil(seconds)) : Math.ceil(seconds / 5) * 5;
    return `About ${s} ${s === 1 ? 'second' : 'seconds'}`;
  }
  const m = Math.ceil(seconds / 60);
  return `About ${m} ${m === 1 ? 'minute' : 'minutes'}`;
}

/** Rendering's time-left line: "Less than a minute left" / "About 1 minute left" / "About 2 minutes left". */
export function timeLeft(seconds: number): string {
  if (seconds < 60) return 'Less than a minute left';
  const m = Math.round(seconds / 60);
  return `About ${m} ${m === 1 ? 'minute' : 'minutes'} left`;
}

export const estimateLine = (items: RenderItem[]) => `${about(estimateSeconds(items))} on this computer. Nothing is uploaded.`;
export const exportButton = (n: number) => `Export ${n} ${n === 1 ? 'video' : 'videos'}`;

/** Seconds left from what this run has measured so far, plus the estimate for files not started. */
export function secondsLeft(elapsedMs: number, frame: number, frames: number, rest: RenderItem[]): number {
  const own = frame > 0 ? (elapsedMs / frame) * (frames - frame) / 1000 : 0;
  return own + estimateSeconds(rest);
}

/** "4.2 MB", "1 KB". */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "0:15" for the file list; "0:06.9" on the frame preview. */
export const clipClock = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function frameClock(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const s = Math.floor(tenths / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
}
