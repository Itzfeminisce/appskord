import { useState, type CSSProperties, type ReactNode } from 'react';
import { BUBBLE_SHARE } from '@/lib/bubble';
import { currentCut } from '@/lib/project/history';
import { addLayer, LABELS, removeLayer, setCamera, updateLayer } from '@/lib/project/ops';
import { toOut, toRec } from '@/lib/project/time';
import type { Camera, Cut, LayoutKind, LayoutSwitch, Project } from '@/lib/project/types';
import { layoutAt } from '@/lib/render/plan';
import { ShapeSection } from '../components/ShapeMenu';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { Heading, Help, Seg, Slider, Switch } from '../timeline/controls';
import { HINTS, LAYOUT_NAMES } from '../timeline/rows';
import { C, MONO } from '../ui';

const KINDS: readonly LayoutKind[] = ['bubble', 'side', 'camera', 'screen'];

const COPY = {
  help: 'To switch layouts partway through, move the playhead and pick another. Each switch shows as a marker on the Camera track.',
  switched: (from: LayoutKind, at: number, to: LayoutKind) =>
    `${LAYOUT_NAMES[from]} until ${clock(at)}, then ${LAYOUT_NAMES[to].toLowerCase()}. Drag the marker on the Camera track to move the switch.`,
  baked: 'The camera is part of the screen video, so camera layouts and background blur are off. Everything else works.',
  blurSub: 'Light preview here. Full quality when you export.',
} as const;

const CORNERS: readonly { value: Camera['corner']; label: string }[] = [
  { value: 'top-left', label: 'Top left' }, { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' }, { value: 'bottom-right', label: 'Bottom right' },
];
const SHAPES = [{ value: 'round', label: 'Round' }, { value: 'rounded', label: 'Rounded' }] as const;
const SWITCHES = [{ value: 'cut', label: 'Cut' }, { value: 'smooth', label: 'Smooth' }] as const;
const BLURS = [{ value: 'blur', label: 'Blur' }, { value: 'colour', label: 'Colour' }] as const;

/** A separate camera track, a camera baked into the screen (v1, v2), or none. */
export function cameraKind(project: Project): 'camera' | 'baked' | 'none' {
  if (project.sources.some((s) => s.kind === 'camera')) return 'camera';
  return project.sources.some((s) => s.kind === 'baked') ? 'baked' : 'none';
}

/** The recording ms the playhead is on; past the end, the last kept ms. */
function recAt(cut: Cut, out: number): number {
  const rec = toRec(cut, out);
  if (rec !== null) return rec;
  const kept = cut.clips.filter((c) => !c.gap);
  return out <= 0 ? (kept[0]?.in ?? 0) : (kept.at(-1)?.out ?? 0);
}

/** The switch in force at the playhead, unless it sits at the very start (then it is the cut's first layout). */
export function activeSwitch(cut: Cut, out: number): LayoutSwitch | null {
  const rec = recAt(cut, out);
  const s = [...cut.layouts].sort((a, b) => a.at - b.at).findLast((x) => x.at <= rec);
  if (!s) return null;
  return (toOut(cut, s.at) ?? 0) > 0 ? s : null;
}

/** Picks a layout at the playhead: a new switch there (a marker on the Camera track), or a change to the one already there. */
export function pickLayout(project: Project, out: number, layout: LayoutKind): Project {
  const cut = currentCut(project);
  const rec = recAt(cut, out);
  if (layoutAt(cut, rec, true).to === layout) return project;
  const label = LABELS.switched(layout, out);
  const here = cut.layouts.find((s) => s.at === rec);
  // A cut shows the new layout at the playhead right away; Smooth is one click in the Switch row.
  if (!here) return addLayer(project, { kind: 'layouts', items: [{ at: rec, layout, switch: 'cut' }], label });
  // Back to the layout before it: the switch has nothing left to do.
  if (layoutAt(cut, rec - 1, true).to === layout) return removeLayer(project, { kind: 'layouts', ids: [here.id], label });
  return updateLayer(project, { kind: 'layouts', id: here.id, patch: { layout }, label });
}

/** "M" for a size near BUBBLE_SHARE.M. */
const sizeName = (size: number) =>
  (Object.entries(BUBBLE_SHARE) as [keyof typeof BUBBLE_SHARE, number][]).reduce((a, b) => (Math.abs(b[1] - size) < Math.abs(a[1] - size) ? b : a))[0];

const FACE = 'radial-gradient(circle at 50% 40%, #F2C9A8 0 30%, #6B6B75 31%)';
const abs = (style: CSSProperties): CSSProperties => ({ position: 'absolute', ...style });
const PICTURES: Record<LayoutKind, ReactNode> = {
  bubble: <span style={abs({ right: 5, bottom: 5, width: 14, height: 14, borderRadius: '50%', background: FACE })} />,
  side: <><span style={abs({ left: 4, top: 8, bottom: 8, width: '58%', borderRadius: 3, background: '#55555F' })} /><span style={abs({ right: 4, top: 8, bottom: 8, width: '28%', borderRadius: 3, background: FACE })} /></>,
  camera: <span style={abs({ inset: 0, background: FACE })} />,
  screen: <span style={abs({ inset: 6, borderRadius: 3, background: '#55555F' })} />,
};

function Tile({ kind, on, disabled, onPick }: { kind: LayoutKind; on: boolean; disabled: boolean; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onPick}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch', padding: 6, borderRadius: 9, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit',
        background: C.ground, border: `1.5px solid ${on ? C.accentText : C.line}`, color: on ? C.text : C.secondary, opacity: disabled ? 0.5 : 1 }}>
      <span style={{ height: 44, borderRadius: 5, background: '#3A3A42', position: 'relative', overflow: 'hidden' }}>{PICTURES[kind]}</span>
      <span style={{ fontSize: 11.5, fontWeight: 500 }}>{LAYOUT_NAMES[kind]}</span>
    </button>
  );
}

/** The inspector's Layout tab (frames Editor and CameraLayout). */
export function LayoutPanel(p: SlotProps) {
  const { cut, project, out, readOnly } = p;
  const camera = cut.camera;
  const [size, setSize] = useState<number | null>(null);
  const kind = cameraKind(project);
  const off = kind !== 'camera';
  const rec = recAt(cut, out);
  const layout = off ? 'screen' : layoutAt(cut, rec, true).to;
  const active = off ? null : activeSwitch(cut, out);
  const before = active ? layoutAt(cut, active.at - 1, true).to : null;
  const from = active ? (toOut(cut, active.at) ?? 0) : 0;
  const lock = readOnly || off;
  const patch = (next: Partial<Camera>) => p.edit((q) => setCamera(q, { patch: next }));
  const shown = size ?? camera.size;

  return (
    <>
      <Heading aside={<span style={{ fontFamily: MONO, fontWeight: 400, color: active ? C.accentText : C.muted }}>{`from ${clock(from)}`}</span>}>Camera layout</Heading>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {KINDS.map((k) => <Tile key={k} kind={k} on={!off && k === layout} disabled={lock} onPick={() => p.edit((q) => pickLayout(q, out, k))} />)}
      </div>
      {off ? (
        <Help>{kind === 'baked' ? COPY.baked : HINTS.noCamera}</Help>
      ) : (
        <>
          <div style={{ marginTop: -4 }}><Help>{active && before ? COPY.switched(before, from, active.layout) : COPY.help}</Help></div>
          {active && (
            <>
              <Heading>Switch</Heading>
              <Seg label="Switch" options={SWITCHES} value={active.switch}
                onChange={(v) => !readOnly && p.edit((q) => updateLayer(q, { kind: 'layouts', id: active.id, patch: { switch: v } }))} />
            </>
          )}
          {layout === 'bubble' && (
            <>
              <Heading>Bubble</Heading>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div role="radiogroup" aria-label="Corner" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, width: 64 }}>
                  {CORNERS.map((c) => (
                    <button key={c.value} type="button" role="radio" aria-label={c.label} title={c.label} aria-checked={camera.corner === c.value} disabled={readOnly}
                      onClick={() => patch({ corner: c.value })}
                      style={{ height: 22, borderRadius: 5, border: `1px solid ${C.line}`, background: camera.corner === c.value ? C.accent : C.ground, cursor: 'pointer' }} />
                  ))}
                </div>
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
                  <Slider label="Size" min={BUBBLE_SHARE.S} max={BUBBLE_SHARE.L} step={0.01} value={shown} text={sizeName(shown)}
                    onInput={setSize} onCommit={(v) => { setSize(null); if (!readOnly && v !== camera.size) patch({ size: v }); }} />
                  <Seg label="Shape" options={SHAPES} value={camera.shape} onChange={(v) => !readOnly && patch({ shape: v })} />
                </div>
              </div>
            </>
          )}
          <Heading>Camera</Heading>
          <Switch label="Blur behind you" sub={COPY.blurSub} on={camera.blur.on} disabled={readOnly}
            onChange={(on) => patch({ blur: { ...camera.blur, on } })} />
          {camera.blur.on && (
            <Seg label="Blur behind you" options={BLURS} value={camera.blur.mode} onChange={(mode) => !readOnly && patch({ blur: { ...camera.blur, mode } })} />
          )}
          <Switch label="Mirror" on={camera.mirror} disabled={readOnly} onChange={(mirror) => patch({ mirror })} />
        </>
      )}
      <ShapeSection shape={cut.shape} fit={cut.fit} readOnly={readOnly} edit={p.edit} />
    </>
  );
}
