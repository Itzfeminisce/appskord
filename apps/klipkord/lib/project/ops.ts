import { MIN_KEPT_MS } from '../editList';
import type { Chapter } from '../types';
import { wordCount, wordsToRanges, type Unit } from '../wordCuts';
import { commit, currentCut } from './history';
import { clipLength, spans, toOut } from './time';
import type { AudioMix, Camera, CaptionStyle, Card, Clip, Cut, LayoutSwitch, Look, Overlay, Placed, Project, Zoom } from './types';

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 4;

/**
 * History labels. Frame copy: "Deleted 13 words", "Added 6 zooms", "Changed background to Ember" (caller's label),
 * "Moved “Pick a role…” before Members" (caller's label). The rest await designer copy; every op takes `label` to override.
 */
export const LABELS = {
  deleteWords: (n: number) => `Deleted ${n} ${n === 1 ? 'word' : 'words'}`,
  restoreWords: (n: number) => `Brought back ${n} ${n === 1 ? 'word' : 'words'}`,
  cutRange: 'Cut a part',
  split: 'Split a clip',
  deleteClip: 'Deleted a clip',
  moveRange: 'Moved a part',
  setSpeed: (speed: number) => `Set speed to ${speed}x`,
  setTransition: 'Changed a transition',
  duplicateClip: 'Duplicated a clip',
  pasteAfter: 'Pasted',
  added: (n: number, noun: string) => `Added ${n} ${noun}`,
  changed: (noun: string) => `Changed ${noun}`,
  removed: (noun: string) => `Removed ${noun}`,
  look: 'Changed the look',
  camera: 'Changed the camera',
  captions: 'Changed captions',
  audio: 'Changed audio',
  track: 'Changed a track',
  fixWord: 'Fixed a word',
  shape: (shape: string) => `Changed shape to ${shape}`,
} as const;

/** Every op may override its default history label. */
export type Labelled<A> = A & { label?: string };

export const newId = (): string => crypto.randomUUID();

/** Applies a change to the current cut and records it as one step; unchanged when the cut is unchanged. */
export function editCut(project: Project, label: string, change: (cut: Cut) => Cut): Project {
  const cut = currentCut(project);
  const next = change(cut);
  if (next === cut) return project;
  return commit(project, label, { ...project, cuts: project.cuts.map((c) => (c.id === cut.id ? next : c)) });
}

const withClips = (cut: Cut, clips: Clip[]): Cut => (sameClips(cut.clips, clips) ? cut : { ...cut, clips });
const sameClips = (a: Clip[], b: Clip[]) => a.length === b.length && a.every((c, i) => c === b[i]);
const hasPicture = (clips: Clip[]) => clips.some((c) => !c.gap);

// ---- Clip maths (pure, exported for cuts.ts, migrate.ts and the AI ops) ----

/** Gives the clip list a boundary at output time `out`; the second half gets a new id and no transition. */
export function splitAt(clips: Clip[], out: number): Clip[] {
  const cut = { clips } as Cut;
  const s = spans(cut).find((x) => out > x.start && out < x.end);
  if (!s) return clips;
  const mid = s.clip.in + (out - s.start) * (s.clip.gap ? 1 : s.clip.speed);
  const { transition: _t, ...rest } = s.clip;
  void _t;
  const first: Clip = { ...s.clip, out: mid };
  const second: Clip = { ...rest, id: newId(), in: mid };
  return [...clips.slice(0, s.index), first, second, ...clips.slice(s.index + 1)];
}

/** Removes recording range `from`..`to` from every clip that plays it. Slivers under MIN_KEPT_MS go too. */
export function removeRec(clips: Clip[], from: number, to: number): Clip[] {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (b <= a) return clips;
  let changed = false;
  const out: Clip[] = [];
  for (const c of clips) {
    if (c.gap || c.out <= a || c.in >= b) { out.push(c); continue; }
    changed = true;
    const { transition, ...rest } = c;
    const parts: Clip[] = [];
    if (a - c.in >= MIN_KEPT_MS) parts.push({ ...c, out: a });
    if (c.out - b >= MIN_KEPT_MS) parts.push(parts.length ? { ...rest, id: newId(), in: b } : { ...rest, ...(transition && { transition }), in: b });
    out.push(...parts);
  }
  return changed ? out : clips;
}

/** Removes output range `from`..`to` from the cut's clips. */
export function removeOut(clips: Clip[], from: number, to: number): Clip[] {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (b <= a) return clips;
  const split = splitAt(splitAt(clips, a), b);
  const kept = spans({ clips: split } as Cut).filter((s) => s.end <= a || s.start >= b).map((s) => s.clip);
  return kept.length === clips.length && kept.every((c, i) => c === clips[i]) ? clips : kept;
}

/** Puts recording range `from`..`to` back where it is missing, next to the clip it continues. */
export function restoreRec(clips: Clip[], from: number, to: number): Clip[] {
  const pictured = clips.filter((c) => !c.gap).sort((x, y) => x.in - y.in);
  // The parts of from..to no clip plays yet.
  const missing: [number, number][] = [];
  let at = from;
  for (const c of pictured) {
    if (c.out <= at) continue;
    if (c.in >= to) break;
    if (c.in > at) missing.push([at, c.in]);
    at = Math.max(at, c.out);
  }
  if (at < to) missing.push([at, to]);
  let out = clips;
  for (const [x, y] of missing) {
    const before = out.findIndex((c) => !c.gap && Math.abs(c.out - x) < 1);
    const after = out.findIndex((c) => !c.gap && Math.abs(c.in - y) < 1);
    if (before >= 0) out = out.map((c, i) => (i === before ? { ...c, out: y } : c));
    else if (after >= 0) out = out.map((c, i) => (i === after ? { ...c, in: x } : c));
    else {
      let index = 0;
      out.forEach((c, i) => { if (!c.gap && c.out <= x) index = i + 1; });
      out = [...out.slice(0, index), { id: newId(), in: x, out: y, speed: 1 }, ...out.slice(index)];
    }
  }
  return out;
}

// ---- Words ----

export interface WordArgs { units: Unit[]; chosen: ReadonlySet<number> }

/** Cuts the chosen transcript units; already-cut neighbours join them so the pause between goes too. */
export function deleteWords(project: Project, { units, chosen, label }: Labelled<WordArgs>): Project {
  if (chosen.size === 0) return project;
  const cut = currentCut(project);
  const all = new Set(chosen);
  units.forEach((w, i) => { if (toOut(cut, (w.start + w.end) / 2) === null) all.add(i); });
  const ranges = wordsToRanges(units, all);
  const clips = ranges.reduce((list, r) => removeRec(list, r.start, r.end), cut.clips);
  if (!hasPicture(clips)) return project;
  return editCut(project, label ?? LABELS.deleteWords(wordCount(units, chosen)), (c) => withClips(c, clips));
}

/** Gives back units `from`..`to` (inclusive), the pauses between them and the pauses to kept neighbours. */
export function restoreWords(project: Project, { units, from, to, label }: Labelled<{ units: Unit[]; from: number; to: number }>): Project {
  const first = units[from];
  const last = units[to];
  if (!first || !last) return project;
  const cut = currentCut(project);
  const kept = (w: Unit | undefined) => !!w && toOut(cut, (w.start + w.end) / 2) !== null;
  const before = units[from - 1];
  const after = units[to + 1];
  const start = kept(before) ? Math.min(first.start, before!.end) : first.start;
  const end = kept(after) ? Math.max(last.end, after!.start) : last.end;
  const n = wordCount(units, Array.from({ length: to - from + 1 }, (_, i) => from + i));
  return editCut(project, label ?? LABELS.restoreWords(n), (c) => withClips(c, restoreRec(c.clips, start, end)));
}

/** Fixes the text of one word; empty text removes the fix. */
export function fixWord(project: Project, { index, text, label }: Labelled<{ index: number; text: string }>): Project {
  const wordFixes = { ...project.wordFixes };
  if (text.trim()) wordFixes[index] = text.trim();
  else delete wordFixes[index];
  if (project.wordFixes[index] === wordFixes[index]) return project;
  return commit(project, label ?? LABELS.fixWord, { ...project, wordFixes });
}

// ---- Clips ----

/** Cuts a range: recording ms by default (every clip that plays it), or output ms of this cut's timeline. */
export function cutRange(project: Project, { from, to, time = 'rec', label }: Labelled<{ from: number; to: number; time?: 'rec' | 'out' }>): Project {
  return editCut(project, label ?? LABELS.cutRange, (c) => {
    const clips = time === 'rec' ? removeRec(c.clips, from, to) : removeOut(c.clips, from, to);
    return hasPicture(clips) ? withClips(c, clips) : c;
  });
}

/** Splits the clip under output time `at`. */
export function split(project: Project, { at, label }: Labelled<{ at: number }>): Project {
  return editCut(project, label ?? LABELS.split, (c) => withClips(c, splitAt(c.clips, at)));
}

/** Deletes a clip and closes the gap, or leaves a gap that shows the background. Never the last picture. */
export function deleteClip(project: Project, { id, leaveGap = false, label }: Labelled<{ id: string; leaveGap?: boolean }>): Project {
  return editCut(project, label ?? LABELS.deleteClip, (c) => {
    const clip = c.clips.find((x) => x.id === id);
    if (!clip) return c;
    const gap: Clip = { id: newId(), in: 0, out: clipLength(clip), speed: 1, gap: true };
    const clips = c.clips.flatMap((x) => (x !== clip ? [x] : leaveGap ? [gap] : []));
    return hasPicture(clips) ? withClips(c, clips) : c;
  });
}

/** Moves the selection `from`..`to` (output ms) so it plays from output time `at` of the current timeline. */
export function moveRange(project: Project, { from, to, at, label }: Labelled<{ from: number; to: number; at: number }>): Project {
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  if (b <= a || (at > a && at < b)) return project;
  return editCut(project, label ?? LABELS.moveRange, (c) => {
    const placed = spans({ ...c, clips: splitAt(splitAt(splitAt(c.clips, a), b), at) });
    const moved = placed.filter((s) => s.start >= a && s.end <= b).map((s) => s.clip);
    const rest = placed.filter((s) => s.end <= a || s.start >= b);
    const index = rest.findIndex((s) => s.start >= at);
    const restClips = rest.map((s) => s.clip);
    const clips = index < 0 ? [...restClips, ...moved] : [...restClips.slice(0, index), ...moved, ...restClips.slice(index)];
    return clips.every((x, i) => x.id === c.clips[i]?.id) && clips.length === c.clips.length ? c : withClips(c, clips);
  });
}

export interface SpeedArgs {
  ids: string[]; speed: number;
  naturalVoice?: boolean;
  /** "Speed up only the silences": the silent recording ranges; the clip splits so only they speed up. */
  silences?: { start: number; end: number }[];
}

/** Sets the speed of clips (0.5 to 4). With `silences`, only those parts change speed and every part is flagged. */
export function setSpeed(project: Project, { ids, speed, naturalVoice, silences, label }: Labelled<SpeedArgs>): Project {
  const rate = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  const chosen = new Set(ids);
  return editCut(project, label ?? LABELS.setSpeed(rate), (c) => {
    const clips = c.clips.flatMap((clip): Clip[] => {
      if (!chosen.has(clip.id) || clip.gap) return [clip];
      const flags = { ...(naturalVoice !== undefined && { naturalVoice }) };
      if (!silences) {
        const { silencesOnly: _s, ...plain } = clip;
        void _s;
        return [{ ...plain, ...flags, speed: rate }];
      }
      const { transition, ...rest } = clip;
      // The transition stays on the first part only: it plays into the clip.
      return silentParts(clip, silences).map((p, i) => ({
        ...rest, ...flags, ...(i === 0 && transition && { transition }),
        id: i === 0 ? clip.id : newId(), in: p.start, out: p.end, speed: p.silent ? rate : 1, silencesOnly: true,
      }));
    });
    return withClips(c, clips);
  });
}

function silentParts(clip: Clip, silences: { start: number; end: number }[]) {
  const parts: { start: number; end: number; silent: boolean }[] = [];
  let at = clip.in;
  for (const s of [...silences].sort((x, y) => x.start - y.start)) {
    const a = Math.max(s.start, at);
    const b = Math.min(s.end, clip.out);
    if (b <= a) continue;
    if (a > at) parts.push({ start: at, end: a, silent: false });
    parts.push({ start: a, end: b, silent: true });
    at = b;
  }
  if (at < clip.out) parts.push({ start: at, end: clip.out, silent: false });
  return parts;
}

/** Sets or clears the transition into a clip. */
export function setTransition(project: Project, { id, transition, label }: Labelled<{ id: string; transition?: Clip['transition'] }>): Project {
  return editCut(project, label ?? LABELS.setTransition, (c) => withClips(c, c.clips.map((clip) => {
    if (clip.id !== id) return clip;
    const { transition: _old, ...rest } = clip;
    void _old;
    return transition ? { ...rest, transition } : rest;
  })));
}

/** Inserts a copy of a clip right after it. */
export function duplicateClip(project: Project, { id, label }: Labelled<{ id: string }>): Project {
  return editCut(project, label ?? LABELS.duplicateClip, (c) => {
    const index = c.clips.findIndex((x) => x.id === id);
    if (index < 0) return c;
    return withClips(c, [...c.clips.slice(0, index + 1), { ...c.clips[index]!, id: newId() }, ...c.clips.slice(index + 1)]);
  });
}

/** Inserts copies of copied clips at output time `at`. */
export function pasteAfter(project: Project, { clips: copied, at, label }: Labelled<{ clips: Clip[]; at: number }>): Project {
  if (copied.length === 0) return project;
  return editCut(project, label ?? LABELS.pasteAfter, (c) => {
    const placed = spans({ ...c, clips: splitAt(c.clips, at) });
    const index = placed.findIndex((s) => s.start >= at);
    const list = placed.map((s) => s.clip);
    const fresh = copied.map((x) => ({ ...x, id: newId() }));
    return withClips(c, index < 0 ? [...list, ...fresh] : [...list.slice(0, index), ...fresh, ...list.slice(index)]);
  });
}

// ---- Layers ----

export interface Layers { zooms: Zoom; layouts: LayoutSwitch; overlays: Overlay; cards: Card; media: Placed; voiceovers: Placed }
export type LayerKind = keyof Layers;
type New<T> = Omit<T, 'id'> & { id?: string };

const NOUNS: Record<LayerKind, [string, string]> = {
  zooms: ['zoom', 'zooms'], layouts: ['layout switch', 'layout switches'], overlays: ['overlay', 'overlays'],
  cards: ['card', 'cards'], media: ['media', 'media'], voiceovers: ['voiceover', 'voiceovers'],
};
const noun = (kind: LayerKind, n: number) => NOUNS[kind][n === 1 ? 0 : 1];

/** Adds layers of one kind, kept in order of their anchor time. */
export function addLayer<K extends LayerKind>(project: Project, { kind, items, label }: Labelled<{ kind: K; items: New<Layers[K]>[] }>): Project {
  if (items.length === 0) return project;
  return editCut(project, label ?? LABELS.added(items.length, noun(kind, items.length)), (c) => {
    const list = [...(c[kind] as Layers[K][]), ...items.map((x) => ({ ...x, id: x.id ?? newId() }) as Layers[K])];
    return { ...c, [kind]: list.sort((x, y) => x.at - y.at) };
  });
}

export function updateLayer<K extends LayerKind>(
  project: Project, { kind, id, patch, label }: Labelled<{ kind: K; id: string; patch: Partial<Omit<Layers[K], 'id'>> }>,
): Project {
  return editCut(project, label ?? LABELS.changed(`a ${noun(kind, 1)}`), (c) => {
    const list = c[kind] as Layers[K][];
    if (!list.some((x) => x.id === id)) return c;
    return { ...c, [kind]: list.map((x) => (x.id === id ? { ...x, ...patch, id } : x)).sort((x, y) => x.at - y.at) };
  });
}

export function removeLayer<K extends LayerKind>(project: Project, { kind, ids, label }: Labelled<{ kind: K; ids: string[] }>): Project {
  const gone = new Set(ids);
  return editCut(project, label ?? LABELS.removed(gone.size === 1 ? `a ${noun(kind, 1)}` : `${gone.size} ${noun(kind, gone.size)}`), (c) => {
    const list = c[kind] as Layers[K][];
    const kept = list.filter((x) => !gone.has(x.id));
    return kept.length === list.length ? c : { ...c, [kind]: kept };
  });
}

// ---- Chapters (project-wide, rec ms) ----

const byAt = (a: Chapter, b: Chapter) => a.at - b.at;

export function addChapter(project: Project, { chapter, label }: Labelled<{ chapter: Chapter }>): Project {
  return commit(project, label ?? LABELS.added(1, 'chapter'), { ...project, chapters: [...project.chapters, chapter].sort(byAt) });
}
export function updateChapter(project: Project, { index, patch, label }: Labelled<{ index: number; patch: Partial<Chapter> }>): Project {
  if (!project.chapters[index]) return project;
  const chapters = project.chapters.map((c, i) => (i === index ? { ...c, ...patch } : c)).sort(byAt);
  return commit(project, label ?? LABELS.changed('a chapter'), { ...project, chapters });
}
export function removeChapter(project: Project, { index, label }: Labelled<{ index: number }>): Project {
  if (!project.chapters[index]) return project;
  return commit(project, label ?? LABELS.removed('a chapter'), { ...project, chapters: project.chapters.filter((_, i) => i !== index) });
}

// ---- Cut settings ----

export function setLook(project: Project, { patch, label }: Labelled<{ patch: Partial<Look> }>): Project {
  return editCut(project, label ?? LABELS.look, (c) => ({ ...c, look: { ...c.look, ...patch } }));
}
export function setCamera(project: Project, { patch, label }: Labelled<{ patch: Partial<Camera> }>): Project {
  return editCut(project, label ?? LABELS.camera, (c) => ({ ...c, camera: { ...c.camera, ...patch } }));
}
export function setCaptions(project: Project, { patch, label }: Labelled<{ patch: Partial<CaptionStyle> }>): Project {
  return editCut(project, label ?? LABELS.captions, (c) => ({ ...c, captions: { ...c.captions, ...patch } }));
}
export function setAudio(project: Project, { patch, label }: Labelled<{ patch: Partial<AudioMix> }>): Project {
  return editCut(project, label ?? LABELS.audio, (c) => ({ ...c, audio: { ...c.audio, ...patch } }));
}
export function setTrack(
  project: Project, { name, patch, label }: Labelled<{ name: string; patch: { hidden?: boolean; locked?: boolean; muted?: boolean } }>,
): Project {
  return editCut(project, label ?? LABELS.track, (c) => ({ ...c, tracks: { ...c.tracks, [name]: { ...c.tracks[name], ...patch } } }));
}
