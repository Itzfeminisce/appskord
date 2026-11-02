import { takeEnd } from '@/lib/project/media';
import { cutLength, type Span } from '@/lib/project/time';
import type { Card, Cut, LayoutKind, Overlay, Placed, Project, Source } from '@/lib/project/types';
import { CLIP_NAME } from './actions';
import { inView, pieces, type View } from './geometry';
import type { SelectKind } from './store';

export type Look = 'screen' | 'camera' | 'voice' | 'zoom' | 'text' | 'music' | 'voiceover' | 'media';

/** One block drawn on a track: output ms. A layer cut into several parts draws one block per part, labelled once. */
export interface Block {
  key: string; id: string; kind: SelectKind; start: number; end: number; label: string; look: Look;
  /** Clips: their index in the cut. */
  index?: number;
  gap?: boolean;
  /** Edges can be dragged; the block can be moved. */
  resizable: boolean; movable: boolean;
}

/** FRAMES.md "Empty track hints". */
export const HINTS = {
  zoom: 'No zooms yet. Press Z to add one at the playhead',
  text: 'Add text, an arrow or a card. Press T',
  music: 'Drop music here',
  voiceover: 'Press V to talk over a part',
  media: 'Drop a video, image or sound here',
  noCamera: 'This recording has no camera',
  noVoice: 'This recording has no voice',
} as const;

export interface Row {
  key: 'screen' | 'camera' | 'voice' | 'voiceover' | 'media' | 'zoom' | 'text' | 'music';
  name: string;
  /** Keys in Cut.tracks this row's Hide, Lock and Mute set. */
  tracks: string[];
  mute: boolean;
  blocks: Block[];
  /** Shown inside the track when it has no block; `add` names what the + opens (none: no + button). */
  hint?: { text: string; add?: 'zoom' | 'text' | 'music' | 'voiceover' | 'media' };
  noClicks?: boolean;
}

const OVERLAY_NAMES: Record<Overlay['kind'], string> = { text: 'Text', arrow: 'Arrow', callout: 'Callout', highlight: 'Highlight', spotlight: 'Spotlight', blur: 'Blur' };

/** "title-hook" → "Title hook". */
export const cardName = (template: string): string => {
  const words = template.replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** "1.6x", "2x". */
export const times = (n: number): string => `${Math.round(n * 100) / 100}x`;

const has = (sources: Source[], ...kinds: Source['kind'][]) => sources.some((s) => kinds.includes(s.kind));
const hasVoice = (sources: Source[]) => sources.some((s) => (s.kind === 'mic' || s.kind === 'tab' || s.kind === 'baked') && s.audio);

function layerBlocks(clipSpans: readonly Span[], view: View, items: { id: string; at: number; end: number; label: string }[], kind: SelectKind, look: Look, resizable: boolean): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    pieces(clipSpans, item.at, item.end).forEach((p, i) => {
      if (inView(p.start, p.end, view)) out.push({ key: `${item.id}:${i}`, id: item.id, kind, start: p.start, end: p.end, label: i === 0 ? item.label : '', look, resizable, movable: true });
    });
  }
  return out;
}

/** The Layout tab's tile names. */
export const LAYOUT_NAMES: Record<LayoutKind, string> = { bubble: 'Bubble', side: 'Side by side', camera: 'Camera full', screen: 'Screen only' };

/** T11: with layout switches, the Camera track shows each layout's stretch; a switch's block drags to move it. */
function cameraBlocks(cut: Cut, clipSpans: readonly Span[], view: View, plain: Block[]): Block[] {
  if (cut.layouts.length === 0) return plain;
  const list = [...cut.layouts].sort((a, b) => a.at - b.at);
  const end = Math.max(0, ...cut.clips.map((c) => c.out));
  const first = { key: 'layout-start', label: LAYOUT_NAMES.bubble, look: 'camera' as const, resizable: false, movable: false };
  const out: Block[] = pieces(clipSpans, Number.NEGATIVE_INFINITY, list[0]!.at).filter((x) => inView(x.start, x.end, view))
    .map((x, i) => ({ ...first, key: `${first.key}:${i}`, id: '', kind: 'layouts', start: x.start, end: x.end, label: i === 0 ? first.label : '' }));
  out.push(...layerBlocks(clipSpans, view, list.map((s, i) => ({ id: s.id, at: s.at, end: list[i + 1]?.at ?? end, label: LAYOUT_NAMES[s.layout] })), 'layouts', 'camera', false));
  return out;
}

const placedEnd = (p: Placed) => p.at + (p.trim[1] - p.trim[0]);
const sourceName = (project: Project, id: string) => project.sources.find((s) => s.id === id)?.name ?? '';

/** The timeline's rows with only the blocks inside the view, so a long recording draws only what shows. */
export function buildRows(project: Project, cut: Cut, clipSpans: readonly Span[], view: View): Row[] {
  const sources = project.sources;
  const visible = clipSpans.filter((s) => inView(s.start, s.end, view));
  const clipBlock = (look: Look, label: (s: Span) => string) => (s: Span): Block => ({
    key: s.clip.id, id: s.clip.id, kind: 'clips', start: s.start, end: s.end, index: s.index, gap: !!s.clip.gap, look,
    label: s.clip.gap ? '' : label(s), resizable: look === 'screen', movable: look === 'screen',
  });
  const camera = has(sources, 'camera');
  const voice = hasVoice(sources);
  const rows: Row[] = [
    { key: 'screen', name: 'Screen', tracks: ['screen'], mute: false, blocks: visible.map(clipBlock('screen', (s) => (s.clip.speed !== 1 ? `${CLIP_NAME} · ${times(s.clip.speed)}` : CLIP_NAME))) },
    { key: 'camera', name: 'Camera', tracks: ['camera'], mute: true, blocks: camera ? cameraBlocks(cut, clipSpans, view, visible.filter((s) => !s.clip.gap).map(clipBlock('camera', () => 'Camera'))) : [], ...(!camera && { hint: { text: HINTS.noCamera } }) },
    { key: 'voice', name: 'Voice', tracks: ['voice'], mute: true, blocks: voice ? visible.filter((s) => !s.clip.gap).map(clipBlock('voice', () => '')) : [], ...(!voice && { hint: { text: HINTS.noVoice } }) },
  ];
  if (cut.voiceovers.length > 0 || cut.tracks.voiceovers) {
    rows.push({ key: 'voiceover', name: 'Voiceover', tracks: ['voiceovers'], mute: true, hint: { text: HINTS.voiceover, add: 'voiceover' },
      blocks: layerBlocks(clipSpans, view, cut.voiceovers.map((v) => ({ id: v.id, at: v.at, end: takeEnd(cut, v), label: '' })), 'voiceovers', 'voiceover', false) });
  }
  // AddMedia: each added file sits on its own track, "Media" or "Sound" then "Media 2"; the file name is on the block.
  const counts = { Media: 0, Sound: 0 };
  for (const m of cut.media) {
    const source = project.sources.find((x) => x.id === m.source);
    const base = source && !source.video && source.audio ? 'Sound' : 'Media';
    const n = ++counts[base];
    const name = sourceName(project, m.source);
    rows.push({ key: 'media', name: n === 1 ? base : `${base} ${n}`, tracks: ['media'], mute: true, hint: { text: HINTS.media, add: 'media' },
      blocks: layerBlocks(clipSpans, view, [{ id: m.id, at: m.at, end: placedEnd(m), label: name }], 'media', 'media', false) });
  }
  rows.push({
    key: 'zoom', name: 'Zoom', tracks: ['zooms'], mute: false, noClicks: !project.events, hint: { text: HINTS.zoom, add: 'zoom' },
    blocks: layerBlocks(clipSpans, view, cut.zooms.map((z) => ({ id: z.id, at: z.at, end: z.end, label: z.focus === 'cursor' ? `${times(z.depth)} · follows cursor` : times(z.depth) })), 'zooms', 'zoom', true),
  });
  rows.push({
    key: 'text', name: 'Text', tracks: ['overlays', 'cards'], mute: false, hint: { text: HINTS.text, add: 'text' },
    blocks: [
      ...layerBlocks(clipSpans, view, cut.overlays.map((o) => ({ id: o.id, at: o.at, end: o.end, label: OVERLAY_NAMES[o.kind] })), 'overlays', 'text', true),
      ...layerBlocks(clipSpans, view, cut.cards.map((c: Card) => ({ id: c.id, at: c.at, end: c.at + c.ms, label: cardName(c.template) })), 'cards', 'text', true),
    ],
  });
  const music = cut.audio.music;
  const length = cutLength(cut);
  rows.push({
    key: 'music', name: 'Music', tracks: ['music'], mute: true, hint: { text: HINTS.music, add: 'music' },
    blocks: music && length > 0 && inView(0, length, view)
      ? [{ key: 'music', id: music.source, kind: 'music', start: 0, end: length, label: sourceName(project, music.source), look: 'music', resizable: false, movable: false }]
      : [],
  });
  return rows;
}

/** Every item of a kind in the cut (for "2 of 6" and box-select over the whole cut). */
export function itemsOf(cut: Cut, kind: SelectKind): { id: string }[] {
  switch (kind) {
    case 'clips': return cut.clips;
    case 'zooms': return cut.zooms;
    case 'layouts': return cut.layouts;
    case 'overlays': return cut.overlays;
    case 'cards': return cut.cards;
    case 'media': return cut.media;
    case 'voiceovers': return cut.voiceovers;
    case 'music': return cut.audio.music ? [{ id: cut.audio.music.source }] : [];
    case 'chapters': return [];
  }
}

const SELECTED_NOUNS: Partial<Record<string, [string, string]>> = {
  clip: ['clip', 'clips'], zoom: ['zoom', 'zooms'], text: ['text', 'texts'], card: ['card', 'cards'], blur: ['blur', 'blurs'],
};

/** Multi-select header: "3 clips selected", "2 blurs selected"; a mix, or blocks without a name, is "{n} items selected". */
export function selectedHeader(kinds: readonly string[]): string {
  const n = kinds.length;
  const nouns = kinds.every((k) => k === kinds[0]) ? SELECTED_NOUNS[kinds[0] ?? ''] : undefined;
  const [one, many] = nouns ?? ['item', 'items'];
  return `${n} ${n === 1 ? one : many} selected`;
}
