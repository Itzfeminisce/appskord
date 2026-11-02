import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { StateCard } from '../states/StateCard';
import { Seg, Switch, TL_ICONS, useEscape } from '../timeline/controls';
import { C, Icon, iconButton } from '../ui';
import { ask } from '../ai/actions';
import { openAsk, useUnits } from '../ai/store';
import { getExport, openExport, exportDeps, type Thumb } from '../components/Exporting';
import { estimateExport, estimateLine, minShort, minutesText } from '@/lib/export/estimate';
import { exportName } from '@/lib/export/files';
import {
  GIF_PRESET, PRESETS, QUALITIES, outputSize, overLimit, presetById, shapeFor, shortSide, videoBitrate, type ContainerId, type PresetId, type QualityId,
} from '@/lib/export/presets';
import type { StillJob } from '@/lib/export/protocol';
import { renderCut } from '@/lib/export/cut';
import { EXPORT_FPS } from '@/lib/export/schedule';
import { cutLength } from '@/lib/project/time';
import type { Shape } from '@/lib/project/types';
import { getSettings } from '@/lib/settings';

const WARN = <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></>;
const LINK = <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>;

/** Footer buttons as the frames draw them. */
export function DialogButton({ tone, children, onClick, disabled, icon }: { tone: 'accent' | 'ghost' | 'raised'; children: ReactNode; onClick: () => void; disabled?: boolean; icon?: ReactNode }) {
  const look = tone === 'accent' ? { background: C.accent, color: '#FFFFFF', border: 0 }
    : tone === 'raised' ? { background: C.raised, color: C.text, border: `1px solid ${C.line}` } : { background: 'transparent', color: C.secondary, border: 0 };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{ height: 32, padding: '0 12px', borderRadius: 8, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
        cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box', opacity: disabled ? 0.5 : 1, ...look }}>
      {icon && <Icon size={15}>{icon}</Icon>}<span>{children}</span>
    </button>
  );
}

/** The export dialogs' frame: title, optional line under it, close, body and a footer row. */
export function ExportModal({ label, sub, width, onClose, footer, children }: { label: string; sub?: string; width: number; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  useEscape(onClose);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,7,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={label} style={{ width, maxHeight: 600, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 16px 0 20px' }}>
          <div style={{ flexGrow: 1 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{label}</h2>
            {sub && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.secondary, lineHeight: 1.5 }}>{sub}</p>}
          </div>
          <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} style={iconButton()}><Icon>{TL_ICONS.close}</Icon></button>
        </div>
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>{children}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderTop: `1px solid ${C.line}` }}>{footer}</div>
      </div>
    </div>
  );
}

function Check({ on, onChange, children, onLabel }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; onLabel?: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
      <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', flexShrink: 0,
        background: on ? C.accent : 'transparent', border: `1.5px solid ${on ? C.accent : C.muted}` }}>
        {on && <Icon size={11} color="#FFFFFF">{<path d="M20 6L9 17l-5-5" />}</Icon>}
      </span>
      {onLabel ? <span role="button" tabIndex={0} onClick={(e) => { e.preventDefault(); onLabel(); }} onKeyDown={(e) => { if (e.key === 'Enter') onLabel(); }}>{children}</span> : children}
    </label>
  );
}

interface Choice {
  preset: PresetId; quality: QualityId; container: ContainerId;
  burn: boolean | null; captionFiles: boolean; chapters: boolean; audioOnly: boolean; thumbnail: boolean; drive: boolean;
}

// The choices stay while the tab is open.
let remembered: Choice = { preset: 'youtube', quality: 'best', container: 'mp4', burn: null, captionFiles: false, chapters: false, audioOnly: false, thumbnail: false, drive: false };

/** ThumbnailPicker's "Use this" also ticks the Thumbnail box. */
export function saveThumbnail(): void {
  remembered = { ...remembered, thumbnail: true };
}

/** What the worker needs, worked out from the dialog's choices. */
export interface ExportPlan {
  name: string; title: string; label: string; lengthMs: number;
  shape: Shape; width: number; height: number; fps: number; container: ContainerId; bitrate: number; hardware: boolean;
  burn: boolean; captionFiles: boolean; chapters: boolean; audioOnly: boolean; drive: boolean;
  thumbnail: Omit<StillJob, 'kind' | 'project' | 'sources' | 'events' | 'captions'> | null;
  /** The same export at Fast · 720p ("Try with Fast"). */
  fast(): ExportPlan;
}

interface Probe { fps: number; hardware: boolean }
const probes = new Map<string, Promise<Probe>>();
function probe(width: number, height: number): Promise<Probe> {
  const key = `${width}x${height}`;
  let p = probes.get(key);
  if (!p) {
    p = import('@appskord/media').then((m) => m.probeEncoder(width, height)).then((r) => ({ fps: r.fps, hardware: r.hardwareH264 }), (error: unknown) => {
      console.error('Klipkord: could not test the encoder', error);
      return { fps: 0, hardware: false };
    });
    probes.set(key, p);
  }
  return p;
}

/** The still the thumbnail saves: 720 on the short side, as ThumbnailPicker shows it. */
export function thumbJob(p: SlotProps, shape: Shape, thumb: Thumb): ExportPlan['thumbnail'] {
  const size = outputSize(shape, 720);
  return { cut: renderCut(p.cut, { shape, camera: thumb.camera }), out: thumb.out, width: size.width, height: size.height, title: { text: thumb.title, style: thumb.style } };
}

/** ExportVideo: preset, quality, format, extra files and the Drive switch. */
const limitText = (ms: number) => (ms < 60_000 || ms % 60_000 ? `${Math.round(ms / 1000)} s` : `${ms / 60_000} min`);

export function ExportVideo({ p, onClose, onStart }: { p: SlotProps; onClose: () => void; onStart: (plan: ExportPlan, dir: FileSystemDirectoryHandle | null) => void }) {
  const [c, setC] = useState<Choice>(remembered);
  const set = (patch: Partial<Choice>) => setC((prev) => (remembered = { ...prev, ...patch }));
  const [folderName, setFolderName] = useState<string | undefined>();
  const [probed, setProbed] = useState<Record<string, Probe>>({});
  const [needDrive, setNeedDrive] = useState(false);
  const length = cutLength(p.cut);
  const preset = presetById(c.preset);
  const units = useUnits(p.recording);
  // Over the limit: close the box and let Ask AI make a cut that fits.
  const makeHighlight = () => {
    if (!preset.limitMs || !preset.limitName) return;
    onClose();
    openAsk();
    void ask(`Make a ${limitText(preset.limitMs)} highlight for ${preset.limitName}`, { project: () => p.project, units, edit: p.edit });
  };
  const shape = shapeFor(preset, p.cut.shape);
  const sizes = useMemo(() => Object.fromEntries(QUALITIES.map((q) => [q.id, outputSize(shape, shortSide(preset, q.id))])) as Record<QualityId, { width: number; height: number }>, [shape, preset]);
  const size = sizes[c.quality];
  const key = (s: { width: number; height: number }) => `${s.width}x${s.height}`;
  const thumb: Thumb = getExport().thumb ?? { out: p.out, title: p.project.name, style: 'none', camera: true };
  const burn = c.burn ?? p.cut.captions.show;

  useEffect(() => {
    getSettings().then((s) => setFolderName(s.folderName), (error: unknown) => console.error('Klipkord: could not read settings', error));
  }, []);
  useEffect(() => {
    let live = true;
    for (const s of Object.values(sizes)) void probe(s.width, s.height).then((r) => { if (live) setProbed((old) => ({ ...old, [key(s)]: r })); });
    return () => { live = false; };
  }, [sizes]);

  const here = probed[key(size)];
  // MP4 needs H.264; where Chrome has no H.264 encoder only WebM is offered.
  const mp4Ok = !here || here.fps > 0;
  const container: ContainerId = mp4Ok ? c.container : 'webm';
  const est = (s: { width: number; height: number }) => estimateExport({ lengthMs: length, width: s.width, height: s.height, encoderFps: probed[key(s)]?.fps ?? 0, audio: true });
  const over = overLimit(preset, length);
  const side = shortSide(preset, c.quality);

  const plan = (quality: QualityId): ExportPlan => {
    const sz = sizes[quality], sd = shortSide(preset, quality);
    return {
      name: exportName(p.project, p.cut, container), title: `Exporting “${p.cut.name}” · ${sd}p`, label: `“${p.cut.name}” · ${clock(length)} · ${sd}p`,
      lengthMs: length, shape, width: sz.width, height: sz.height, fps: EXPORT_FPS, container, bitrate: videoBitrate(sz.width, sz.height),
      hardware: probed[key(sz)]?.hardware ?? false, burn, captionFiles: c.captionFiles, chapters: c.chapters, audioOnly: c.audioOnly, drive: c.drive,
      thumbnail: c.thumbnail ? thumbJob(p, shape, thumb) : null, fast: () => plan('fast'),
    };
  };

  const start = async () => {
    const dir = folderName ? await exportDeps.folder() : null;
    onStart(plan(c.quality), dir);
  };

  const onDrive = (on: boolean) => {
    set({ drive: on });
    setNeedDrive(false);
    if (on) void exportDeps.token(false).then((t) => setNeedDrive(!t), () => setNeedDrive(true));
  };
  const connect = () => {
    exportDeps.token(true).then((t) => setNeedDrive(!t), (error: unknown) => console.error('Klipkord: could not connect Google Drive', error));
  };

  const card = (id: string, name: string, sub: string, selected: boolean, onClick: () => void, warn?: string) => (
    <button key={id} type="button" aria-pressed={selected} onClick={onClick}
      style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', borderRadius: 10, background: C.raised, border: `1.5px solid ${selected ? C.accentText : C.line}`, color: C.text, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
      <span style={{ fontSize: 11.5, color: C.muted }}>{sub}</span>
      {warn && <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: '#FCD34D' }}><Icon size={12}>{WARN}</Icon>{warn}</span>}
    </button>
  );

  return (
    <ExportModal label={`Export “${p.cut.name}”`} width={640} onClose={onClose}
      sub={folderName ? `Saved to ${folderName}. The project stays as it is.` : 'Saved to your Downloads folder. The project stays as it is.'}
      footer={<>
        <span style={{ fontSize: 12, color: C.muted, flexGrow: 1 }}>Export keeps going while you edit. Close this box, but keep the tab open.</span>
        <DialogButton tone="ghost" onClick={onClose}>Cancel</DialogButton>
        <DialogButton tone="accent" icon={<><path d="M12 3v12" /><path d="M7 8l5-5 5 5" /><path d="M5 21h14" /></>} onClick={() => void start()} disabled={length <= 0}>{`Export ${clock(length)}`}</DialogButton>
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {PRESETS.map((pr) => {
          const o = overLimit(pr, length);
          return card(pr.id, pr.name, pr.sub, c.preset === pr.id, () => set({ preset: pr.id }), o && pr.limitMs ? `${clock(length)} is over ${clock(pr.limitMs)}` : undefined);
        })}
        {card('gif', GIF_PRESET.name, GIF_PRESET.sub, false, () => openExport('gif'))}
      </div>
      {over > 0 && preset.limitName && (
        <StateCard state="export-over-limit" compact title={`Over the ${preset.limitName} limit by ${clock(over)}`}
          body={`It will still export. ${preset.limitName} may cut it short or refuse it.`}
          actions={preset.limitMs ? [{ label: `Make a ${limitText(preset.limitMs)} highlight`, tone: 'secondary', onClick: makeHighlight }] : []} />
      )}
      {here && !here.hardware && c.quality === 'best' && (
        <StateCard state="export-slow" compact title="Exports take longer here"
          body={`This computer has no video encoder Chrome can use, so ${clock(length)} takes ${minutesText(est(sizes.best).seconds)}. Fast (720p) takes about ${minShort(est(sizes.fast).seconds)}.`}
          actions={[{ label: 'Use Fast', tone: 'secondary', onClick: () => set({ quality: 'fast' }) }]} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.secondary }}>Quality</span>
          <Seg label="Quality" options={preset.maxSide === 720 ? QUALITIES.filter((q) => q.id === 'fast').map((q) => ({ value: q.id, label: q.label })) : QUALITIES.map((q) => ({ value: q.id, label: q.label }))}
            value={side === 720 ? 'fast' : c.quality} onChange={(quality) => set({ quality })} />
          <span style={{ fontSize: 12, color: C.muted }}>{estimateLine(est(size))}</span>
          <Seg label="Format" options={mp4Ok ? [{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }] : [{ value: 'webm', label: 'WebM' }]}
            value={container} onChange={(v) => set({ container: v as ContainerId })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.secondary }}>Also save</span>
          <Check on={burn} onChange={(on) => set({ burn: on })}>Captions burned in</Check>
          <Check on={c.captionFiles} onChange={(on) => set({ captionFiles: on })}>Captions file (SRT and VTT)</Check>
          <Check on={c.chapters} onChange={(on) => set({ chapters: on })}>Chapters for YouTube</Check>
          <Check on={c.audioOnly} onChange={(on) => set({ audioOnly: on })}>Audio only (M4A)</Check>
          <Check on={c.thumbnail} onChange={(on) => set({ thumbnail: on })} onLabel={() => openExport('thumbnail')}>{`Thumbnail (frame at ${clock(thumb.out)})`}</Check>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}`, fontSize: 12.5 }}>
        <Icon size={15} color={C.secondary}>{LINK}</Icon>
        <span style={{ flexGrow: 1, color: C.secondary }}>Also make a share link in your Google Drive</span>
        <Switch label="" on={c.drive} onChange={onDrive} />
      </div>
      {c.drive && needDrive && (
        <StateCard state="drive-connect" compact title="Connect Google Drive" body="Klipkord can only see the files it uploads."
          actions={[{ label: 'Connect Google', tone: 'primary', onClick: connect }]} />
      )}
    </ExportModal>
  );
}
