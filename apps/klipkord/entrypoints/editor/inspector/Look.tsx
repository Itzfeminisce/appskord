import { useState, type CSSProperties } from 'react';
import { setLook } from '@/lib/project/ops';
import type { Look, Project, Shape } from '@/lib/project/types';
import { FRAME } from '@/lib/render/plan';
import { GRADIENTS } from '@/lib/render/layers/background';
import type { SlotProps } from '../components/slots';
import { AddMedia } from '../dialogs/AddMedia';
import { Heading, Seg, Slider, Switch } from '../timeline/controls';
import { C } from '../ui';

type Kind = Look['background']['kind'];
const KINDS: { value: Kind; label: string }[] = [
  { value: 'colour', label: 'Colour' }, { value: 'gradient', label: 'Gradient' }, { value: 'image', label: 'Image' }, { value: 'blurred', label: 'Blurred screen' },
];
/** Solid backgrounds, in swatch order. A "Brand" swatch joins them once brand kits exist (T14). */
export const COLOURS = [
  { name: 'Ink', value: '#111114' }, { name: 'White', value: '#FFFFFF' }, { name: 'Sand', value: '#F5F0E6' },
  { name: 'Clay', value: '#C2410C' }, { name: 'Navy', value: '#1E3A8A' }, { name: 'Sage', value: '#84A98C' },
] as const;
const SIZES = [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] as const;
type Size = (typeof SIZES)[number]['value'];
export const CURSOR_SIZE: Record<Size, number> = { small: 0.75, medium: 1, large: 1.5 };
const sizeOf = (n: number): Size => (n < 0.9 ? 'small' : n > 1.2 ? 'large' : 'medium');

/** Padding is stored as px at 1080p and shown as a share of the output width, 0% to 20%. */
export const PADDING_MAX_PCT = 20;
export const paddingPct = (px: number, shape: Shape) => Math.round((px / FRAME[shape].w) * 100);
export const paddingPx = (pct: number, shape: Shape) => Math.round((pct / 100) * FRAME[shape].w);
export const CORNERS_MAX = 24;
/** Shadow stops, blur px at 1080p; the UI shows only the words. */
export const SHADOWS = [{ label: 'None', px: 0 }, { label: 'Soft', px: 24 }, { label: 'Medium', px: 40 }, { label: 'Strong', px: 60 }] as const;
export const shadowStop = (px: number) => SHADOWS.reduce((best, s, i) => (Math.abs(s.px - px) < Math.abs(SHADOWS[best]!.px - px) ? i : best), 0);

const imagesOf = (project: Project) => project.sources.filter((s) => s.kind === 'media' && s.mime.startsWith('image/'));
const gradientCss = (id: string) => `linear-gradient(135deg, ${GRADIENTS[id]!.map(([c, at]) => `${c} ${Math.round(at * 100)}%`).join(', ')})`;

/** The background's name in its Undo step: "Changed background to Ember". */
export function backgroundName(project: Project, bg: Look['background']): string {
  if (bg.kind === 'gradient') return bg.value.charAt(0).toUpperCase() + bg.value.slice(1);
  if (bg.kind === 'image') return project.sources.find((s) => s.id === bg.value)?.name ?? 'Image';
  if (bg.kind === 'blurred') return 'Blurred screen';
  return COLOURS.find((c) => c.value.toLowerCase() === bg.value.toLowerCase())?.name ?? bg.value;
}

/** What a kind starts with when picked: its first swatch, or the image already in use. */
function firstOf(project: Project, kind: Kind, now: Look['background']): Look['background'] | null {
  if (kind === now.kind) return null;
  if (kind === 'colour') return { kind, value: COLOURS[0].value };
  if (kind === 'gradient') return { kind, value: Object.keys(GRADIENTS)[0]! };
  if (kind === 'blurred') return { kind, value: '' };
  const image = imagesOf(project)[0];
  return image ? { kind, value: image.id } : null;
}

const swatch = (on: boolean, background: string): CSSProperties => ({
  width: 36, height: 26, borderRadius: 6, cursor: 'pointer', background, border: `2px solid ${on ? '#FFFFFF' : 'transparent'}`, boxSizing: 'border-box', padding: 0,
});

/** The Look tab (FrameLook): background, the frame around the screen, and the cursor of tab recordings. */
export function LookPanel(p: SlotProps) {
  const { project, cut, readOnly, edit } = p;
  const [adding, setAdding] = useState(false);
  const look = cut.look;
  const bg = look.background;
  const [draft, setDraft] = useState<Partial<Pick<Look, 'padding' | 'corners' | 'shadow'>>>({});
  const shown = { ...look, ...draft };
  const setBackground = (next: Look['background'] | null) => {
    if (readOnly || !next || (next.kind === bg.kind && next.value === bg.value)) return;
    edit((p) => setLook(p, { patch: { background: next }, label: `Changed background to ${backgroundName(p, next)}` }));
  };
  const drag = (key: 'padding' | 'corners' | 'shadow', v: number) => !readOnly && setDraft((d) => ({ ...d, [key]: v }));
  const commitFrame = (key: 'padding' | 'corners' | 'shadow', v: number) => {
    // Drop the key, not set it undefined: a spread undefined would hide the saved value.
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    if (!readOnly && v !== look[key]) edit((p) => setLook(p, { patch: { [key]: v } }));
  };
  const setCursor = (patch: Partial<Look['cursor']>) => !readOnly && edit((p) => setLook(p, { patch: { cursor: { ...look.cursor, ...patch } } }));
  const images = imagesOf(project);
  const swatches: { value: string; css: string; name?: string }[] = bg.kind === 'colour'
    ? COLOURS.map((c) => ({ value: c.value, css: c.value, name: c.name }))
    : bg.kind === 'gradient' ? Object.keys(GRADIENTS).map((id) => ({ value: id, css: gradientCss(id) }))
    : bg.kind === 'image' ? images.map((s) => ({ value: s.id, css: C.raised, name: s.name }))
    : [];
  return (
    <>
      <Heading>Background</Heading>
      <Seg label="Background" options={KINDS} value={bg.kind} disabled={readOnly}
        onChange={(k) => (k === 'image' && !images.length ? !readOnly && setAdding(true) : setBackground(firstOf(project, k, bg)))} />
      {swatches.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {swatches.map((s, i) => (
            <button key={s.value} type="button" aria-label={`Background ${i + 1}`} aria-pressed={s.value === bg.value} title={s.name}
              disabled={readOnly} onClick={() => setBackground({ kind: bg.kind, value: s.value })} style={swatch(s.value === bg.value, s.css)} />
          ))}
        </div>
      )}

      <Heading>Frame</Heading>
      <Slider label="Padding" min={0} max={PADDING_MAX_PCT} step={1} value={paddingPct(shown.padding, cut.shape)} text={`${paddingPct(shown.padding, cut.shape)}%`} disabled={readOnly}
        onInput={(v) => drag('padding', paddingPx(v, cut.shape))} onCommit={(v) => commitFrame('padding', paddingPx(v, cut.shape))} />
      <Slider label="Corners" min={0} max={CORNERS_MAX} step={1} value={shown.corners} text={`${shown.corners} px`} disabled={readOnly}
        onInput={(v) => drag('corners', v)} onCommit={(v) => commitFrame('corners', v)} />
      <Slider label="Shadow" min={0} max={SHADOWS.length - 1} step={1} value={shadowStop(shown.shadow)} text={SHADOWS[shadowStop(shown.shadow)]!.label} disabled={readOnly}
        onInput={(v) => drag('shadow', SHADOWS[v]!.px)} onCommit={(v) => commitFrame('shadow', SHADOWS[v]!.px)} />

      <Heading aside={<span style={{ fontWeight: 400, color: C.muted }}>tab recordings</span>}>Cursor</Heading>
      <Seg label="Cursor size" options={SIZES} value={sizeOf(look.cursor.size)} disabled={readOnly} onChange={(s) => setCursor({ size: CURSOR_SIZE[s] })} />
      <Switch label="Smooth the movement" on={look.cursor.smooth} disabled={readOnly} onChange={(smooth) => setCursor({ smooth })} />
      <Switch label="Show clicks" sub="A soft ring on every click." on={look.cursor.clicks} disabled={readOnly} onChange={(clicks) => setCursor({ clicks })} />
      {adding && <AddMedia p={p} start="computer" onClose={() => setAdding(false)} />}
    </>
  );
}
