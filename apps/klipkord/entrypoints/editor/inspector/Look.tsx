import { useState, type CSSProperties } from 'react';
import { setLook } from '@/lib/project/ops';
import type { Look, Project } from '@/lib/project/types';
import { GRADIENTS } from '@/lib/render/layers/background';
import type { SlotProps } from '../components/slots';
import { Heading, Seg, Slider, Switch } from '../timeline/controls';
import { C } from '../ui';

type Kind = Look['background']['kind'];
const KINDS: { value: Kind; label: string }[] = [
  { value: 'colour', label: 'Colour' }, { value: 'gradient', label: 'Gradient' }, { value: 'image', label: 'Image' }, { value: 'blurred', label: 'Blurred screen' },
];
/** Solid backgrounds: the default ground, then the gradients' own colours. */
export const COLOURS = ['#1C1917', '#C2410C', '#1E3A8A', '#14532D', '#F5F5F4', '#581C87'] as const;
const SIZES = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] as const;
type Size = (typeof SIZES)[number]['value'];
export const CURSOR_SIZE: Record<Size, number> = { small: 0.75, medium: 1, large: 1.5 };
const sizeOf = (n: number): Size => (n < 0.9 ? 'small' : n > 1.2 ? 'large' : 'medium');

/** Padding is px at 1080p and shows as a share of the frame's short side. */
const SHORT_SIDE = 1080;
export const PADDING_MAX = 162;
export const CORNERS_MAX = 24;
export const SHADOW_MAX = 48;
export const paddingText = (px: number) => `${Math.round((px / SHORT_SIDE) * 100)}%`;
export const shadowText = (px: number) => (px > 0 ? 'Soft' : '0 px');

const imagesOf = (project: Project) => project.sources.filter((s) => s.kind === 'media' && s.mime.startsWith('image/'));
const gradientCss = (id: string) => `linear-gradient(135deg, ${GRADIENTS[id]!.map(([c, at]) => `${c} ${Math.round(at * 100)}%`).join(', ')})`;

/** The background's name in its Undo step: "Changed background to Ember". */
export function backgroundName(project: Project, bg: Look['background']): string {
  if (bg.kind === 'gradient') return bg.value.charAt(0).toUpperCase() + bg.value.slice(1);
  if (bg.kind === 'image') return project.sources.find((s) => s.id === bg.value)?.name ?? 'Image';
  if (bg.kind === 'blurred') return 'Blurred screen';
  return bg.value;
}

/** What a kind starts with when picked: its first swatch, or the image already in use. */
function firstOf(project: Project, kind: Kind, now: Look['background']): Look['background'] | null {
  if (kind === now.kind) return null;
  if (kind === 'colour') return { kind, value: COLOURS[0] };
  if (kind === 'gradient') return { kind, value: Object.keys(GRADIENTS)[0]! };
  if (kind === 'blurred') return { kind, value: '' };
  const image = imagesOf(project)[0];
  return image ? { kind, value: image.id } : null;
}

const swatch = (on: boolean, background: string): CSSProperties => ({
  width: 36, height: 26, borderRadius: 6, cursor: 'pointer', background, border: `2px solid ${on ? '#FFFFFF' : 'transparent'}`, boxSizing: 'border-box', padding: 0,
});

/** The Look tab (FrameLook): background, the frame around the screen, and the cursor of tab recordings. */
export function LookPanel({ project, cut, readOnly, edit }: SlotProps) {
  const look = cut.look;
  const bg = look.background;
  const [draft, setDraft] = useState<Partial<Pick<Look, 'padding' | 'corners' | 'shadow'>>>({});
  const shown = { ...look, ...draft };
  const setBackground = (next: Look['background'] | null) => {
    if (readOnly || !next || (next.kind === bg.kind && next.value === bg.value)) return;
    edit((p) => setLook(p, { patch: { background: next }, label: `Changed background to ${backgroundName(p, next)}` }));
  };
  const commitFrame = (key: 'padding' | 'corners' | 'shadow', v: number) => {
    setDraft((d) => ({ ...d, [key]: undefined }));
    if (!readOnly && v !== look[key]) edit((p) => setLook(p, { patch: { [key]: v } }));
  };
  const setCursor = (patch: Partial<Look['cursor']>) => !readOnly && edit((p) => setLook(p, { patch: { cursor: { ...look.cursor, ...patch } } }));
  const images = imagesOf(project);
  const swatches: { value: string; css: string; name?: string }[] = bg.kind === 'colour'
    ? COLOURS.map((c) => ({ value: c, css: c }))
    : bg.kind === 'gradient' ? Object.keys(GRADIENTS).map((id) => ({ value: id, css: gradientCss(id) }))
    : bg.kind === 'image' ? images.map((s) => ({ value: s.id, css: C.raised, name: s.name }))
    : [];
  const kinds = images.length ? KINDS : KINDS.filter((k) => k.value !== 'image' || bg.kind === 'image');
  return (
    <>
      <Heading>Background</Heading>
      <Seg label="Background" options={kinds} value={bg.kind} onChange={(k) => setBackground(firstOf(project, k, bg))} />
      {swatches.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {swatches.map((s, i) => (
            <button key={s.value} type="button" aria-label={`Background ${i + 1}`} aria-pressed={s.value === bg.value} title={s.name}
              disabled={readOnly} onClick={() => setBackground({ kind: bg.kind, value: s.value })} style={swatch(s.value === bg.value, s.css)} />
          ))}
        </div>
      )}

      <Heading>Frame</Heading>
      <Slider label="Padding" min={0} max={PADDING_MAX} step={6} value={shown.padding} text={paddingText(shown.padding)}
        onInput={(v) => setDraft((d) => ({ ...d, padding: v }))} onCommit={(v) => commitFrame('padding', Math.round(v))} />
      <Slider label="Corners" min={0} max={CORNERS_MAX} step={1} value={shown.corners} text={`${shown.corners} px`}
        onInput={(v) => setDraft((d) => ({ ...d, corners: v }))} onCommit={(v) => commitFrame('corners', v)} />
      <Slider label="Shadow" min={0} max={SHADOW_MAX} step={4} value={shown.shadow} text={shadowText(shown.shadow)}
        onInput={(v) => setDraft((d) => ({ ...d, shadow: v }))} onCommit={(v) => commitFrame('shadow', v)} />

      <Heading aside={<span style={{ fontWeight: 400, color: C.muted }}>tab recordings</span>}>Cursor</Heading>
      <Seg label="Cursor size" options={SIZES} value={sizeOf(look.cursor.size)} onChange={(s) => setCursor({ size: CURSOR_SIZE[s] })} />
      <Switch label="Smooth the movement" on={look.cursor.smooth} disabled={readOnly} onChange={(smooth) => setCursor({ smooth })} />
      <Switch label="Show clicks" sub="A soft ring on every click." on={look.cursor.clicks} disabled={readOnly} onChange={(clicks) => setCursor({ clicks })} />
    </>
  );
}
