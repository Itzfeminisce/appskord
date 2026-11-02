import { useEffect, useMemo, useState } from 'react';
import { exportDeps, renderStill, type Thumb } from '../components/Exporting';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { Seg, Switch } from '../timeline/controls';
import { C } from '../ui';
import { DialogButton, ExportModal } from './ExportVideo';
import { renderCut } from '@/lib/export/cut';
import { outputSize } from '@/lib/export/presets';
import type { TitleStyle } from '@/lib/export/protocol';
import { cutLength } from '@/lib/project/time';

const STRIP = 8;
const STYLES: { value: TitleStyle; label: string }[] = [{ value: 'none', label: 'No title' }, { value: 'bold', label: 'Bold' }, { value: 'clean', label: 'Clean' }];

/** An object URL for a blob, let go when it changes or the dialog closes. */
function useUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

/** ThumbnailPicker: a frame, an optional title and the camera, rendered as the JPG the export saves. */
export function ThumbnailPicker({ p, thumb, onBack, onUse }: { p: SlotProps; thumb: Thumb | null; onBack: () => void; onUse: (thumb: Thumb) => void }) {
  const [t, setT] = useState<Thumb>(thumb ?? { out: p.out, title: p.project.name, style: 'none', camera: true });
  const length = cutLength(p.cut);
  const size = outputSize(p.cut.shape, 720);
  const media = useMemo(() => exportDeps.loadMedia(p.project), [p.project.sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const [still, setStill] = useState<Blob | null>(null);
  const [strip, setStrip] = useState<(Blob | null)[]>([]);
  const outs = useMemo(() => Array.from({ length: STRIP }, (_, i) => Math.round(((i + 0.5) * length) / STRIP)), [length]);
  const burn = p.cut.captions.show;

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void media.then((m) => renderStill(p, { cut: renderCut(p.cut, { camera: t.camera }), out: t.out, width: size.width, height: size.height,
        title: { text: t.title, style: t.style }, burn }, m)).then((b) => { if (live) setStill(b); }, (error: unknown) => console.error('Klipkord: could not draw the thumbnail', error));
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [t, media]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    void (async () => {
      const m = await media;
      const small = outputSize(p.cut.shape, 90);
      for (const out of outs) {
        if (!live) return;
        const b = await renderStill(p, { cut: renderCut(p.cut, {}), out, width: small.width, height: small.height, burn: false }, m).catch(() => null);
        if (live) setStrip((s) => [...s, b]);
      }
    })();
    return () => { live = false; };
  }, [outs, media]); // eslint-disable-line react-hooks/exhaustive-deps

  const url = useUrl(still);
  const nearest = outs.reduce((best, o, i) => (Math.abs(o - t.out) < Math.abs(outs[best]! - t.out) ? i : best), 0);

  return (
    <ExportModal label="Thumbnail" width={620} onClose={onBack}
      footer={<>
        <span style={{ flexGrow: 1 }} />
        <DialogButton tone="ghost" onClick={onBack}>Back</DialogButton>
        <DialogButton tone="accent" onClick={() => onUse(t)}>Use this</DialogButton>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>
        <div style={{ height: 169, borderRadius: 8, overflow: 'hidden', background: C.raised, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {url && <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="kk-thumb-title" style={{ fontSize: 11.5, color: C.secondary }}>Title on the thumbnail · optional</label>
            <input id="kk-thumb-title" value={t.title} onChange={(e) => setT({ ...t, title: e.target.value, style: t.style === 'none' && e.target.value ? 'bold' : t.style })}
              style={{ height: 34, borderRadius: 8, border: `1px solid ${C.line}`, background: C.ground, color: C.text, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }} />
          </div>
          <Seg label="Title style" options={STYLES} value={t.style} onChange={(style) => setT({ ...t, style })} />
          <Switch label="Show your camera" on={t.camera} onChange={(camera) => setT({ ...t, camera })} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {outs.map((out, i) => (
          <StripFrame key={out} blob={strip[i] ?? null} selected={i === nearest} onClick={() => setT({ ...t, out })} at={out} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <DialogButton tone="raised" onClick={() => setT({ ...t, out: p.out })}>Use the playhead frame</DialogButton>
        <span style={{ fontSize: 12, color: C.muted }}>{`Frame at ${clock(t.out)} · ${size.width} × ${size.height} JPG`}</span>
      </div>
    </ExportModal>
  );
}

function StripFrame({ blob, selected, onClick, at }: { blob: Blob | null; selected: boolean; onClick: () => void; at: number }) {
  const url = useUrl(blob);
  return (
    <button type="button" aria-label={clock(at)} onClick={onClick}
      style={{ flex: 1, height: 40, padding: 0, border: 0, borderRadius: 4, cursor: 'pointer', background: url ? `center / cover no-repeat url(${url})` : C.raised,
        opacity: selected ? 1 : 0.7, outline: selected ? `2px solid ${C.accentText}` : 'none', outlineOffset: 1 }} />
  );
}
