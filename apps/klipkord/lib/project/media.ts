import type { Segment } from '../types';
import { currentCut, group } from './history';
import { addLayer, LABELS, newId, setAudio, updateLayer } from './ops';
import { cutLength, spans, toOut, toRec } from './time';
import type { Cut, Placed, Project, Source } from './types';

/** A still image stays on screen this long when it is added. */
export const IMAGE_MS = 5000;
/** The longest a voiceover range can run when there is no sentence to end it. */
export const OPEN_RANGE_MS = 10_000;

export type MediaKind = 'video' | 'image' | 'sound';
export interface Format { kind: MediaKind; mime: string }

// The AddMedia drop zone's list: MP4, WebM, MOV, PNG, JPG, GIF, MP3, WAV, M4A.
const FORMATS: Record<string, Format> = {
  mp4: { kind: 'video', mime: 'video/mp4' }, webm: { kind: 'video', mime: 'video/webm' }, mov: { kind: 'video', mime: 'video/quicktime' },
  png: { kind: 'image', mime: 'image/png' }, jpg: { kind: 'image', mime: 'image/jpeg' }, jpeg: { kind: 'image', mime: 'image/jpeg' }, gif: { kind: 'image', mime: 'image/gif' },
  mp3: { kind: 'sound', mime: 'audio/mpeg' }, wav: { kind: 'sound', mime: 'audio/wav' }, m4a: { kind: 'sound', mime: 'audio/mp4' },
};

export const extensionOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** What a file is, from its extension; null for a format AddMedia does not take (import-unsupported). */
export function formatOf(name: string): (Format & { ext: string }) | null {
  const ext = extensionOf(name);
  const f = FORMATS[ext];
  return f ? { ...f, ext } : null;
}

/** The file's name inside the recording's OPFS folder (CONTRACT: media-<id>.<ext>, voiceover-<id>.webm). */
export const fileName = (kind: 'media' | 'voiceover' | 'music', id: string, ext: string): string => `${kind}-${id}.${ext}`;

export interface Probed { duration: number; width?: number; height?: number; video: boolean; audio: boolean }

/** The project's source for an added file; `duration` is ms (an image gets IMAGE_MS). */
export function mediaSource(o: { id: string; kind: Source['kind']; file: string; mime: string; name: string; probed: Probed }): Source {
  const image = o.mime.startsWith('image/');
  return {
    id: o.id, kind: o.kind, file: o.file, mime: o.mime, name: o.name, offset: 0,
    duration: image ? IMAGE_MS : Math.round(o.probed.duration),
    width: o.probed.width, height: o.probed.height, video: o.probed.video || image, audio: o.probed.audio && !image,
  };
}

/** Recording ms for the playhead (output ms), kept inside the recording; a playhead on a gap lands at the recording's end. */
export function placeAt(cut: Cut, out: number, recMax: number): number {
  const rec = toRec(cut, Math.max(0, Math.min(out, cutLength(cut) - 1)));
  return Math.round(Math.max(0, Math.min(rec ?? recMax, recMax)));
}

const withSource = (project: Project, source: Source): Project =>
  project.sources.some((s) => s.id === source.id) ? project : { ...project, sources: [...project.sources, source] };

/** Adds a file at `at` (recording ms) on its own track as one Undo step. */
export function addMedia(project: Project, { source, at }: { source: Source; at: number }): Project {
  const label = LABELS.addedMedia(source.name ?? source.file);
  return group(project, label, (p) => addLayer(withSource(p, source), {
    kind: 'media', label, items: [{ source: source.id, at, trim: [0, source.duration], volume: 1, muted: false }],
  }));
}

/** Bundled or own music: replaces the current track and keeps the mix settings the project already has. */
export function addMusic(project: Project, { source, volume = 0.3 }: { source: Source; volume?: number }): Project {
  const label = LABELS.music(source.name ?? source.file);
  return group(project, label, (p) => {
    const old = currentCut(p).audio.music;
    return setAudio(withSource(p, source), { label, patch: { music: { duck: true, fadeIn: 1000, fadeOut: 1000, ...old, source: source.id, volume: old?.volume ?? volume } } });
  });
}

/** A take's recording-time end. Its file plays at rate 1 from the clip it starts in, so a 2x clip covers twice its length. */
export function takeEnd(cut: Cut, v: Placed): number {
  const s = spans(cut).find((x) => !x.clip.gap && v.at >= x.clip.in && v.at < x.clip.out);
  return v.at + (v.trim[1] - v.trim[0]) * (s?.clip.speed ?? 1);
}

/** Where one piece of a take plays: a recording-ms anchor and a range of the take file. */
export interface TakePiece { at: number; trim: [number, number] }

/**
 * Splits a take said over output ms [from, to) into one piece per clip it crossed, each anchored at the recording ms
 * that was playing then, so each piece stays where it was said across cuts and speed. `fileAt` is the take-file ms
 * heard at output `from`. A gap has no recording time, so what was said over one is left out.
 */
export function takePieces(cut: Cut, from: number, to: number, fileAt = 0): TakePiece[] {
  const pieces: TakePiece[] = [];
  for (const s of spans(cut)) {
    const a = Math.max(from, s.start), b = Math.min(to, s.end);
    if (s.clip.gap || b - a < 1) continue;
    pieces.push({ at: Math.round(s.clip.in + (a - s.start) * s.clip.speed), trim: [Math.round(fileAt + a - from), Math.round(fileAt + b - from)] });
  }
  return pieces;
}

// An earlier take this much under a new one is muted whole; less, and only the part under it is.
const MOSTLY = 0.8;

/** The recording-ms ranges of `ranges` inside [lo, hi), merged. */
function inside(ranges: [number, number][], lo: number, hi: number): [number, number][] {
  const cut = ranges.map(([a, b]): [number, number] => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of cut) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}

/** Silences the parts of an earlier take under `over`: all of it when mostly covered, else it splits and mutes what is covered. */
function muteUnder(project: Project, v: Placed, over: [number, number][]): Project {
  const end = takeEnd(currentCut(project), v), covered = inside(over, v.at, end);
  const total = covered.reduce((n, [a, b]) => n + b - a, 0);
  if (total === 0) return project;
  const patch = (x: Partial<Placed>) => updateLayer(project, { kind: 'voiceovers', id: v.id, patch: x, label: LABELS.voiceover });
  if (total >= MOSTLY * (end - v.at)) return patch({ muted: true });
  const k = (end - v.at) / Math.max(1, v.trim[1] - v.trim[0]);
  const edges = [...new Set([v.at, ...covered.flat(), end])].sort((a, b) => a - b);
  const pieces = edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1]!;
    return { at: a, trim: [Math.round(v.trim[0] + (a - v.at) / k), Math.round(v.trim[0] + (b - v.at) / k)] as [number, number],
      muted: covered.some(([x, y]) => a >= x && b <= y) };
  });
  const [first, ...rest] = pieces;
  const { id: _id, ...same } = v;
  const kept = updateLayer(project, { kind: 'voiceovers', id: v.id, patch: first!, label: LABELS.voiceover });
  return addLayer(kept, { kind: 'voiceovers', label: LABELS.voiceover, items: rest.map((x) => ({ ...same, ...x })) });
}

/**
 * Adds a voiceover take, as one piece at `at` or as the `pieces` it was said over (takePieces). An earlier take mostly
 * under the new one is kept but silenced, so the newest is heard; one partly under it is silenced only there.
 * Unmuting another picks it instead. `clean` runs this take alone through "Clean and level".
 */
export function addVoiceover(project: Project, { source, at = 0, pieces, muteOriginal = true, clean = false, id = newId() }:
  { source: Source; at?: number; pieces?: TakePiece[]; muteOriginal?: boolean; clean?: boolean; id?: string }): Project {
  const parts = pieces ?? [{ at, trim: [0, source.duration] }];
  const takes: Placed[] = parts.map((x, i) => ({ id: i === 0 ? id : newId(), source: source.id, at: x.at, trim: x.trim, volume: 1, muted: false, muteOriginal,
    ...(clean && { clean: true }) }));
  const fresh = new Set(takes.map((t) => t.id));
  return group(project, LABELS.voiceover, (p) => {
    const before = currentCut(p).voiceovers.filter((v) => !v.muted);
    const added = addLayer(withSource(p, source), { kind: 'voiceovers', label: LABELS.voiceover, items: takes });
    const over = takes.map((t): [number, number] => [t.at, takeEnd(currentCut(added), t)]);
    return before.filter((v) => !fresh.has(v.id)).reduce((q, v) => muteUnder(q, v, over), added);
  });
}

const overlaps = (cut: Cut, a: Placed, b: Placed) => a.at < takeEnd(cut, b) && b.at < takeEnd(cut, a);

/** Every take that covers the same spot as `take`, oldest first (the order sources were added). */
export function takesOver(project: Project, take: Placed): Placed[] {
  const order = new Map(project.sources.map((s, i) => [s.id, i]));
  const cut = currentCut(project);
  return cut.voiceovers.filter((v) => overlaps(cut, v, take)).sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));
}

/** "take 2": this take's place among the takes over the same spot. */
export const takeNumber = (project: Project, take: Placed): number => takesOver(project, take).findIndex((v) => v.id === take.id) + 1;

export interface VoiceRange { startOut: number; endOut: number }

/**
 * Where a voiceover is recorded, in output ms: the selected clips when there are any, else the playhead to the end of
 * the sentence being said (the next one when the playhead sits between two), else OPEN_RANGE_MS or the cut's end.
 */
export function voiceRange(cut: Cut, o: { out: number; selectedClips: readonly string[]; transcript: readonly Segment[] }): VoiceRange {
  const length = cutLength(cut);
  const chosen = spans(cut).filter((s) => o.selectedClips.includes(s.clip.id) && !s.clip.gap);
  if (chosen.length) return { startOut: chosen[0]!.start, endOut: chosen[chosen.length - 1]!.end };
  const start = Math.max(0, Math.min(o.out, length));
  const ends = o.transcript.map((s) => toOut(cut, Math.max(s.start, s.end - 1))).filter((t): t is number => t !== null && t > start + 500).sort((a, b) => a - b);
  return { startOut: start, endOut: Math.min(length, ends[0] ?? start + OPEN_RANGE_MS) };
}

/** The fixed height of the meter in the recording pill: bars from a level of 0..1. */
export function meterBars(level: number, count = 7, shape = [0.45, 0.7, 1, 0.65, 0.85, 0.35, 0.55]): number[] {
  const l = Math.max(0, Math.min(1, level));
  return Array.from({ length: count }, (_, i) => Math.max(3, Math.round(16 * l * (shape[i % shape.length] ?? 1))));
}
