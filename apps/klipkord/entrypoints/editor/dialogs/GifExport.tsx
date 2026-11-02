import { useEffect, useMemo, useRef, useState } from 'react';
import { exportDeps, renderStill } from '../components/Exporting';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { Seg } from '../timeline/controls';
import { C, MONO } from '../ui';
import { DialogButton, ExportModal } from './ExportVideo';
import { renderCut } from '@/lib/export/cut';
import { gifBytes, sizeText } from '@/lib/export/estimate';
import { exportName } from '@/lib/export/files';
import { FRAME } from '@/lib/render/plan';
import { cutLength } from '@/lib/project/time';
import { getSettings } from '@/lib/settings';

export const GIF_MAX_MS = 15_000;
const SIZES = [480, 640, 800] as const;
const RATES = [10, 15] as const;
const PREVIEW_FRAMES = 8;

export interface GifPlan { name: string; title: string; label: string; width: number; height: number; fps: number; from: number; to: number }

/** A part of at most 15 s inside the cut, starting at `from`. */
export function clampPart(from: number, to: number, length: number): { from: number; to: number } {
  const span = Math.min(GIF_MAX_MS, Math.max(500, to - from), length);
  const start = Math.min(Math.max(0, from), Math.max(0, length - span));
  return { from: start, to: start + span };
}

/** GifExport: a part of up to 15 s, its size and smoothness, made from the rendered frames. */
export function GifExport({ p, onBack, onClose, onStart }: { p: SlotProps; onBack: () => void; onClose: () => void; onStart: (plan: GifPlan, dir: FileSystemDirectoryHandle | null) => void }) {
  const length = cutLength(p.cut);
  const [part, setPart] = useState(() => clampPart(p.out, p.out + 8000, length));
  const [width, setWidth] = useState<number>(640);
  const [fps, setFps] = useState<number>(15);
  const f = FRAME[p.cut.shape];
  const height = Math.max(2, Math.round((width * f.h) / f.w / 2) * 2);
  const ms = part.to - part.from;
  const strip = useRef<HTMLDivElement>(null);

  // The looping preview: a few frames across the part, shown in turn.
  const media = useMemo(() => exportDeps.loadMedia(p.project), [p.project.sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const [frames, setFrames] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    const timer = setTimeout(() => void (async () => {
      const m = await media;
      const small = { width: 356, height: Math.round((356 * f.h) / f.w / 2) * 2 };
      for (let i = 0; i < PREVIEW_FRAMES && live; i++) {
        const b = await renderStill(p, { cut: renderCut(p.cut, {}), out: part.from + (i * ms) / PREVIEW_FRAMES, ...small, burn: p.cut.captions.show }, m).catch(() => null);
        if (!b || !live) continue;
        const url = URL.createObjectURL(b);
        urls.push(url);
        setFrames([...urls]);
      }
    })(), 300);
    return () => { live = false; clearTimeout(timer); urls.forEach((u) => URL.revokeObjectURL(u)); setFrames([]); };
  }, [part.from, part.to, media]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setInterval(() => setShown((n) => n + 1), Math.max(100, ms / PREVIEW_FRAMES));
    return () => clearInterval(t);
  }, [ms]);

  // Drag the part to move it; drag an edge to change its length.
  const drag = (e: React.PointerEvent, mode: 'move' | 'start' | 'end') => {
    e.preventDefault();
    e.stopPropagation();
    const box = strip.current?.getBoundingClientRect();
    if (!box) return;
    const x0 = e.clientX, start = part;
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - x0) / box.width) * length;
      if (mode === 'move') setPart(clampPart(start.from + d, start.to + d, length));
      else if (mode === 'start') setPart(clampPart(Math.min(start.to - 500, Math.max(start.to - GIF_MAX_MS, start.from + d)), start.to, length));
      else setPart(clampPart(start.from, Math.max(start.from + 500, Math.min(start.from + GIF_MAX_MS, start.to + d)), length));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const make = async () => {
    const folder = (await getSettings().catch(() => null))?.folderName;
    const dir = folder ? await exportDeps.folder() : null;
    onStart({ name: exportName(p.project, p.cut, 'gif'), title: `Exporting “${p.cut.name}” · GIF`, label: `“${p.cut.name}” · ${clock(ms)} · GIF`, width, height, fps, from: part.from, to: part.to }, dir);
  };

  const pct = (t: number) => `${(100 * t) / Math.max(1, length)}%`;
  return (
    <ExportModal label="GIF of a part" width={560} onClose={onClose}
      footer={<>
        <DialogButton tone="raised" onClick={() => setPart(clampPart(p.out, p.out + ms, length))}>Start at playhead</DialogButton>
        <span style={{ flexGrow: 1 }} />
        <DialogButton tone="ghost" onClick={onBack}>Back</DialogButton>
        <DialogButton tone="accent" onClick={() => void make()} disabled={length <= 0}>Make GIF</DialogButton>
      </>}>
      <div style={{ height: 200, borderRadius: 8, position: 'relative', overflow: 'hidden', background: C.raised, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {frames.length > 0 && <img src={frames[shown % frames.length]} alt="" style={{ maxWidth: '100%', maxHeight: '100%' }} />}
        <span style={{ position: 'absolute', left: 10, top: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(17,17,20,0.8)', color: '#FFFFFF', fontSize: 11, fontWeight: 600 }}>Loops</span>
      </div>
      <div ref={strip} style={{ position: 'relative', height: 40, borderRadius: 6, background: '#33333B', overflow: 'hidden' }}>
        <span role="slider" aria-label="Part" aria-valuemin={0} aria-valuemax={length} aria-valuenow={part.from} tabIndex={0} onPointerDown={(e) => drag(e, 'move')}
          style={{ position: 'absolute', left: pct(part.from), width: pct(ms), top: 0, bottom: 0, border: `2px solid ${C.accentText}`, borderRadius: 6, background: 'rgba(251,146,60,0.15)', boxSizing: 'border-box', cursor: 'grab' }}>
          <span onPointerDown={(e) => drag(e, 'start')} style={{ position: 'absolute', left: -4, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
          <span onPointerDown={(e) => drag(e, 'end')} style={{ position: 'absolute', right: -4, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }} />
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto 1fr', gap: '8px 14px', fontSize: 12.5, alignItems: 'center' }}>
        <span style={{ color: C.secondary }}>Part</span><span style={{ fontFamily: MONO }}>{`${clock(part.from)} to ${clock(part.to)} · ${Math.round(ms / 1000)} s`}</span>
        <span style={{ color: C.secondary }}>Size</span><Seg label="Size" options={SIZES.map((s) => ({ value: String(s), label: String(s) }))} value={String(width)} onChange={(v) => setWidth(Number(v))} />
        <span style={{ color: C.secondary }}>Smoothness</span><Seg label="Smoothness" options={RATES.map((r) => ({ value: String(r), label: `${r} fps` }))} value={String(fps)} onChange={(v) => setFps(Number(v))} />
        <span style={{ color: C.secondary }}>File</span><span style={{ fontFamily: MONO }}>{`about ${sizeText(gifBytes(ms, width, height, fps))}`}</span>
      </div>
      <span style={{ fontSize: 12, color: C.muted }}>Up to 15 s. No sound. Zooms, cursor and captions are kept.</span>
    </ExportModal>
  );
}
