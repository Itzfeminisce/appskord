import { useState, type ReactElement } from 'react';
import { group } from '@/lib/project/history';
import { LABELS, removeChapter, setTransition, split, updateLayer } from '@/lib/project/ops';
import { spans } from '@/lib/project/time';
import type { Clip, Feel, Project, Zoom } from '@/lib/project/types';
import type { InspectorProps, Selection } from '../components/Inspector';
import type { SlotProps } from '../components/slots';
import { clock, seconds } from '../format';
import { C, Icon, MONO } from '../ui';
import { ChaptersEdit } from '../dialogs/ChaptersEdit';
import { deleteSelected } from './actions';
import { chaptersInCut } from './chapters';
import { Btn, Heading, Help, Seg, Slider, TL_ICONS } from './controls';
import { itemsOf, selectedHeader, times } from './rows';
import { select, setTimeline, timelineState, type SelectKind, type Selected } from './store';

const MULTI_HELP = (n: number) => `Changes apply to all ${n}. Shift+click adds one; drag on empty space to box-select.`;
const TRANSITIONS = [{ value: 'none', label: 'None' }, { value: 'fade', label: 'Cross-fade' }, { value: 'zoom', label: 'Zoom' }] as const;
const FEELS: { value: Feel; label: string }[] = [{ value: 'calm', label: 'Calm' }, { value: 'smooth', label: 'Smooth' }, { value: 'snappy', label: 'Snappy' }];
const DEFAULT_TRANSITION_MS = 300;

/** TimelineClip's inspector: source, in and out, speed, Split / Speed / Delete, the transition into the clip. */
function ClipPanel({ p, clips }: { p: SlotProps; clips: Clip[] }) {
  const one = clips.length === 1 ? clips[0]! : null;
  const source = p.project.sources.find((s) => s.kind === 'screen') ?? p.project.sources.find((s) => s.kind === 'baked');
  const transition = clips[0]?.transition;
  const [ms, setMs] = useState<number | null>(null);
  const length = ms ?? transition?.ms ?? DEFAULT_TRANSITION_MS;
  const ids = clips.map((c) => c.id);
  const setAll = (t: Clip['transition']) => p.edit((project) => (ids.length === 1
    ? setTransition(project, { id: ids[0]!, transition: t })
    : group(project, LABELS.setTransition(t?.kind), (q) => ids.reduce((r, id) => setTransition(r, { id, transition: t }), q))));
  const splitHere = () => {
    if (!one) return;
    const s = spans(p.cut).find((x) => x.clip.id === one.id);
    if (!s) return;
    const at = p.out > s.start && p.out < s.end ? p.out : (s.start + s.end) / 2;
    p.edit((project) => split(project, { at }));
  };
  return (
    <>
      <Heading>{one ? 'Clip' : selectedHeader(clips.map(() => 'clip'))}</Heading>
      {one && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 14px', fontSize: 12.5 }}>
          <span style={{ color: C.secondary }}>Source</span><span>{p.project.name}{source ? ` · ${source.kind === 'baked' ? 'screen' : source.kind}` : ''}</span>
          <span style={{ color: C.secondary }}>In and out</span><span style={{ fontFamily: MONO }}>{clock(one.in, true)} to {clock(one.out, true)}</span>
          <span style={{ color: C.secondary }}>Speed</span><span style={{ fontFamily: MONO }}>{times(one.speed)}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {one && <Btn icon={TL_ICONS.split} onClick={splitHere} disabled={p.readOnly}>Split</Btn>}
        <Btn icon={TL_ICONS.speed} onClick={() => setTimeline({ speedOpen: true })} active={timelineState().speedOpen} disabled={p.readOnly}>Speed</Btn>
        <Btn icon={TL_ICONS.trash} onClick={() => p.edit((project) => deleteSelected(project, { kind: 'clips', ids }))} disabled={p.readOnly}>{one ? 'Delete' : `Delete ${clips.length}`}</Btn>
      </div>
      <Heading>Transition into this clip</Heading>
      <Seg options={TRANSITIONS} value={transition?.kind ?? 'none'} onChange={(v) => setAll(v === 'none' ? undefined : { kind: v, ms: length })} />
      {transition && (
        <Slider label="Length" min={100} max={1000} step={100} value={length} text={seconds(length)} onInput={setMs}
          onCommit={(v) => { setMs(null); setAll({ kind: transition.kind, ms: v }); }} />
      )}
      <Help>{one ? 'Edges snap to word starts, clicks and markers. Hold Alt to drag freely.' : MULTI_HELP(clips.length)}</Help>
    </>
  );
}

/** Zooms selected on the timeline: depth and feel for all of them at once. */
function ZoomsPanel({ p, zooms }: { p: SlotProps; zooms: Zoom[] }) {
  const [depth, setDepth] = useState<number | null>(null);
  const n = zooms.length;
  const shown = depth ?? zooms[0]?.depth ?? 1.5;
  const feel = zooms.every((z) => z.feel === zooms[0]?.feel) ? zooms[0]?.feel : undefined;
  const patchAll = (patch: Partial<Zoom>) => p.edit((project) => (n === 1
    ? updateLayer(project, { kind: 'zooms', id: zooms[0]!.id, patch })
    : group(project, LABELS.changedMany(n, 'zooms'), (q) => zooms.reduce((r, z) => updateLayer(r, { kind: 'zooms', id: z.id, patch }), q))));
  return (
    <>
      {n > 1 && <Heading>{selectedHeader(zooms.map(() => 'zoom'))}</Heading>}
      <Slider label="Depth" min={1.1} max={3} step={0.1} value={shown} text={`${shown.toFixed(1)}x`} onInput={setDepth}
        onCommit={(v) => { setDepth(null); patchAll({ depth: v }); }} />
      <Seg options={FEELS} value={feel} onChange={(v) => patchAll({ feel: v })} />
      {n > 1 && <Help>{MULTI_HELP(n)}</Help>}
      {n > 1 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn icon={TL_ICONS.trash} onClick={() => p.edit((project) => deleteSelected(project, { kind: 'zooms', ids: zooms.map((z) => z.id) }))}>{`Delete ${n}`}</Btn>
        </div>
      )}
    </>
  );
}

const NAMES: Record<Selected['kind'], [string, string]> = {
  clips: ['Clip', 'Clips'], zooms: ['Zoom', 'Zooms'], overlays: ['Text', 'Text'], cards: ['Card', 'Cards'],
  music: ['Music', 'Music'], media: ['Media', 'Media'], voiceovers: ['Voiceover', 'Voiceover'], chapters: ['Chapters', 'Chapters'],
};
const KIND_ICONS: Record<Selected['kind'], ReactElement> = {
  clips: TL_ICONS.screen, zooms: TL_ICONS.zoom, overlays: TL_ICONS.text, cards: TL_ICONS.text, music: TL_ICONS.music,
  media: TL_ICONS.screen, voiceovers: TL_ICONS.mic, chapters: TL_ICONS.flag,
};

/** The selection still in the cut (an undo can take items away); null when nothing is left. */
export function liveSelection(project: Project, selected: Selected | null): Selected | null {
  if (!selected) return null;
  if (selected.kind === 'chapters') return project.chapters[Number(selected.ids[0])] ? selected : null;
  const cut = project.cuts.find((c) => c.id === project.current) ?? project.cuts[0];
  if (!cut) return null;
  const all = new Set(itemsOf(cut, selected.kind).map((x) => x.id));
  const ids = selected.ids.filter((id) => all.has(id));
  return ids.length ? { kind: selected.kind, ids } : null;
}

/** One noun per selected item, for the multi-select header. */
function selectedKinds(cut: SlotProps['cut'], selected: Selected): string[] {
  if (selected.kind === 'overlays') return cut.overlays.filter((o) => selected.ids.includes(o.id)).map((o) => o.kind);
  const noun = ({ clips: 'clip', zooms: 'zoom', cards: 'card' } as Partial<Record<SelectKind, string>>)[selected.kind] ?? selected.kind;
  return selected.ids.map(() => noun);
}

/** The inspector slot: the timeline's selection swaps the tabs for that item. */
export function timelineInspector(p: SlotProps): Pick<InspectorProps, 'selection'> {
  const selected = liveSelection(p.project, timelineState().selected);
  if (!selected) return { selection: null };
  const onBack = () => select(null);
  if (selected.kind === 'chapters') {
    const index = Number(selected.ids[0]);
    const n = chaptersInCut(p.project, p.cut).length;
    const selection: Selection = {
      name: 'Chapters', icon: <Icon>{TL_ICONS.flag}</Icon>, index: 1, count: n, place: `${n} in this cut`, onBack,
      onDelete: () => { select(null); p.edit((project) => removeChapter(project, { index })); },
      body: <ChaptersEdit {...p} />,
    };
    return { selection };
  }
  const all = itemsOf(p.cut, selected.kind);
  const n = selected.ids.length;
  const first = all.findIndex((x) => x.id === selected.ids[0]);
  const [one, many] = NAMES[selected.kind];
  let body: ReactElement | null = null;
  if (selected.kind === 'clips') body = <ClipPanel p={p} clips={p.cut.clips.filter((c) => selected.ids.includes(c.id))} />;
  else if (selected.kind === 'zooms') body = <ZoomsPanel p={p} zooms={p.cut.zooms.filter((z) => selected.ids.includes(z.id))} />;
  const selection: Selection = {
    name: n > 1 ? many : one, icon: <Icon>{KIND_ICONS[selected.kind]}</Icon>, index: first + 1, count: all.length,
    ...(n > 1 && { place: selectedHeader(selectedKinds(p.cut, selected)) }),
    onBack,
    onDelete: () => { select(null); p.edit((project) => deleteSelected(project, selected)); },
    body: <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{body}</div>,
  };
  return { selection };
}
