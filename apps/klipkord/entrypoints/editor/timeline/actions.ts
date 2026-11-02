import { duplicateCut } from '@/lib/project/cuts';
import { currentCut, group } from '@/lib/project/history';
import { addLayer, deleteClip, duplicateClip, editCut, LABELS, moveRange, newId, pasteAfter, quote, removeLayer, setAudio, setSpeed, split, updateLayer, type LayerKind } from '@/lib/project/ops';
import { cutLength, spans, type Span } from '@/lib/project/time';
import type { Clip, Cut, Placed, Project, Source } from '@/lib/project/types';
import type { Word } from '@/lib/types';
import type { Selected } from './store';

/** The screen block's name in the frames; also the words of a clip with no transcript. */
export const CLIP_NAME = 'Recording';

/** TimelineMenu, in the frame's order. */
export const MENU = [
  { id: 'split', label: 'Split here', keys: 'S' },
  { id: 'speed', label: 'Speed…', keys: 'R' },
  { id: 'duplicate', label: 'Duplicate', keys: 'Ctrl D' },
  { id: 'copy', label: 'Copy', keys: 'Ctrl C' },
  { id: 'paste', label: 'Paste after', keys: 'Ctrl V' },
  { id: 'detach', label: 'Detach audio' },
  { id: 'newCut', label: 'Make a cut from this' },
  { id: 'deleteClose', label: 'Delete and close the gap', keys: 'Del' },
  { id: 'deleteGap', label: 'Delete and leave a gap', keys: 'Shift Del' },
] as const;
export type MenuAction = (typeof MENU)[number]['id'];

export interface MenuResult {
  project: Project;
  clipboard?: Clip[];
  /** Open the speed popover for the selection. */
  speed?: boolean;
  /** A new cut was made and is current: open the Cuts menu with its name ready to edit. */
  renaming?: boolean;
}

export interface MenuContext {
  /** Output time the menu was opened at ("Split here"). */
  at: number;
  clipboard: Clip[];
  words: readonly Word[];
}

const CLIP_NOUNS: [string, string] = ['clip', 'clips'];

/** The selected clips in play order. */
export function selectedSpans(cut: Cut, ids: readonly string[]): Span[] {
  const chosen = new Set(ids);
  return spans(cut).filter((s) => chosen.has(s.clip.id));
}

/** The sound to detach: the mic, else the tab sound, else an older recording's own audio. */
export const audioSource = (sources: Source[]): Source | undefined =>
  sources.find((s) => s.kind === 'mic') ?? sources.find((s) => s.kind === 'tab') ?? sources.find((s) => s.kind === 'baked' && s.audio);

/** Runs one TimelineMenu action on the selected clips; every edit goes through lib/project ops as one Undo step. */
export function runMenu(project: Project, action: MenuAction, ids: readonly string[], ctx: MenuContext): MenuResult {
  const cut = currentCut(project);
  const chosen = selectedSpans(cut, ids);
  if (chosen.length === 0 && action !== 'paste') return { project };
  const n = chosen.length;
  switch (action) {
    case 'split': {
      const inside = chosen.find((s) => ctx.at > s.start && ctx.at < s.end);
      const at = inside ? ctx.at : (chosen[0]!.start + chosen[0]!.end) / 2;
      return { project: split(project, { at }) };
    }
    case 'speed':
      return { project, speed: true };
    case 'duplicate':
      return {
        project: n === 1 ? duplicateClip(project, { id: chosen[0]!.clip.id })
          : group(project, LABELS.added(n, CLIP_NOUNS), (p) => chosen.reduce((q, s) => duplicateClip(q, { id: s.clip.id }), p)),
      };
    case 'copy':
      return { project, clipboard: chosen.map((s) => s.clip) };
    case 'paste': {
      const after = chosen.length ? chosen[chosen.length - 1]!.end : ctx.at;
      return { project: pasteAfter(project, { clips: ctx.clipboard, at: after }) };
    }
    case 'detach': {
      const source = audioSource(project.sources);
      if (!source) return { project };
      const items: Omit<Placed, 'id'>[] = chosen.filter((s) => !s.clip.gap).map((s) => ({
        source: source.id, at: s.clip.in, trim: [s.clip.in - source.offset, s.clip.out - source.offset], volume: 1, muted: false, muteOriginal: true,
      }));
      return { project: addLayer(project, { kind: 'media', items }) };
    }
    case 'newCut': {
      const name = chapterAt(project, chosen[0]!.clip.in) ?? cut.name;
      const copy = duplicateCut(project, { id: cut.id, name });
      const clips = chosen.map((s) => ({ ...s.clip, id: newId() }));
      const made = editCut(copy, LABELS.highlight(name), (c) => ({ ...c, clips, made: 'manual' }));
      return { project: made, renaming: true };
    }
    case 'deleteClose':
    case 'deleteGap':
      return { project: deleteClips(project, chosen.map((s) => s.clip.id), action === 'deleteGap') };
  }
}

/** Deletes clips, closing or leaving their gaps; several are one step. */
export function deleteClips(project: Project, ids: readonly string[], leaveGap: boolean): Project {
  if (ids.length === 1) return deleteClip(project, { id: ids[0]!, leaveGap });
  return group(project, LABELS.removed(ids.length, CLIP_NOUNS), (p) => ids.reduce((q, id) => deleteClip(q, { id, leaveGap }), p));
}

export const LAYERS: Partial<Record<Selected['kind'], LayerKind>> = { zooms: 'zooms', overlays: 'overlays', cards: 'cards', media: 'media', voiceovers: 'voiceovers' };

/** Del: deletes whatever is selected. Clips close the gap unless `leaveGap` (Shift+Del). */
export function deleteSelected(project: Project, selected: Selected, leaveGap = false): Project {
  if (selected.kind === 'clips') return deleteClips(project, selected.ids, leaveGap);
  const kind = LAYERS[selected.kind];
  if (kind) return removeLayer(project, { kind, ids: [...selected.ids] });
  if (selected.kind === 'music') return setAudio(project, { patch: { music: undefined } });
  return project;
}

/** The chapter that starts at `rec`, if any. */
function chapterAt(project: Project, rec: number): string | undefined {
  return project.chapters.find((c) => Math.abs(c.at - rec) < 1)?.title;
}

/** The first words said in recording range from..to, for labels; the block's name when nothing is said there. */
export function wordsIn(words: readonly Word[], from: number, to: number, count = 4): string {
  const said = words.filter((w) => w.start >= from && w.start < to).slice(0, count).map((w) => w.text.trim());
  return said.length ? said.join(' ') : CLIP_NAME;
}

/**
 * Drag to reorder: moves the clip so it plays from output time `at` (dropAt), labelled
 * "Moved “words” before <chapter or “words”>". Dropping at the end moves what follows the clip before it instead.
 */
export function moveClip(project: Project, { id, at, words }: { id: string; at: number; words: readonly Word[] }): Project {
  const cut = currentCut(project);
  const all = spans(cut);
  const own = all.find((s) => s.clip.id === id);
  if (!own) return project;
  const length = cutLength(cut);
  if (at >= length - 0.5) {
    if (own.end >= length - 0.5) return project;
    const after = all.filter((s) => s.start >= own.end);
    const label = LABELS.moveRange(wordsIn(words, after[0]!.clip.in, after[0]!.clip.out), before(project, own, words));
    return moveRange(project, { from: own.end, to: length, at: own.start, label });
  }
  const target = all.find((s) => Math.abs(s.start - at) < 0.5);
  if (!target) return project;
  const label = LABELS.moveRange(wordsIn(words, own.clip.in, own.clip.out), before(project, target, words));
  return moveRange(project, { from: own.start, to: own.end, at, label });
}

/** The chapter name at a clip's start, else its first words quoted. */
function before(project: Project, s: Span, words: readonly Word[]): string {
  return chapterAt(project, s.clip.in) ?? quote(wordsIn(words, s.clip.in, s.clip.out));
}

/** Pauses inside a clip, from the transcript: gaps of at least `minMs` between words, less a little air on each side. */
export function silencesIn(words: readonly Word[], from: number, to: number, minMs = 700, airMs = 150): { start: number; end: number }[] {
  const inside = words.filter((w) => w.end > from && w.start < to);
  const out: { start: number; end: number }[] = [];
  let last = from;
  for (const w of inside) {
    if (w.start - last >= minMs) out.push({ start: last + (last === from ? 0 : airMs), end: w.start - airMs });
    last = Math.max(last, w.end);
  }
  if (to - last >= minMs) out.push({ start: last + (last === from ? 0 : airMs), end: to });
  return out.filter((r) => r.end > r.start);
}

/** The speed popover's change on the selected clips: one setSpeed step; "only the silences" finds the pauses from the transcript. */
export function speedClips(project: Project, ids: readonly string[], { speed, naturalVoice, silences }: { speed: number; naturalVoice?: boolean; silences?: boolean }, words: readonly Word[]): Project {
  if (!silences) return setSpeed(project, { ids: [...ids], speed, ...(naturalVoice !== undefined && { naturalVoice }) });
  const cut = currentCut(project);
  const chosen = cut.clips.filter((c) => ids.includes(c.id) && !c.gap);
  const pauses = chosen.flatMap((c) => silencesIn(words, c.in, c.out));
  return setSpeed(project, { ids: [...ids], speed, silences: pauses, ...(naturalVoice !== undefined && { naturalVoice }) });
}

/** Duplicate for zoom, text and media blocks: each copy plays right after its original. */
export function duplicateLayers(project: Project, selected: Selected): Project {
  const kind = LAYERS[selected.kind];
  if (!kind) return project;
  const chosen = new Set(selected.ids);
  const items = (currentCut(project)[kind] as { id: string; at: number }[]).filter((x) => chosen.has(x.id)).map((x) => {
    const { id: _id, ...rest } = x as { id: string; at: number; end?: number; ms?: number; trim?: [number, number] };
    void _id;
    const len = rest.end !== undefined ? rest.end - rest.at : rest.ms ?? (rest.trim ? rest.trim[1] - rest.trim[0] : 0);
    return { ...rest, at: rest.at + len, ...(rest.end !== undefined && { end: rest.end + len }) };
  });
  return addLayer(project, { kind, items: items as never[] });
}

/** Moves layers by `dRec` (recording ms) or sets one edge; one step. Cards keep `ms`, media and voiceovers move only. */
export function shiftLayers(project: Project, kind: LayerKind, ids: readonly string[], change: { dRec?: number; edge?: 'start' | 'end'; rec?: number }): Project {
  const cut = currentCut(project);
  const list = cut[kind] as { id: string; at: number; end?: number; ms?: number }[];
  const chosen = list.filter((x) => ids.includes(x.id));
  const patchOf = (x: (typeof list)[number]): Record<string, number> => {
    const end = x.end ?? (x.ms !== undefined ? x.at + x.ms : x.at);
    if (change.dRec !== undefined) {
      const at = Math.max(0, x.at + change.dRec);
      return x.end !== undefined ? { at, end: at + (x.end - x.at) } : { at };
    }
    const rec = change.rec ?? x.at;
    if (change.edge === 'start') {
      const at = Math.max(0, Math.min(rec, end - 100));
      return x.end !== undefined ? { at } : x.ms !== undefined ? { at, ms: end - at } : { at };
    }
    const newEnd = Math.max(x.at + 100, rec);
    return x.end !== undefined ? { end: newEnd } : x.ms !== undefined ? { ms: newEnd - x.at } : {};
  };
  if (chosen.length === 1) return updateLayer(project, { kind, id: chosen[0]!.id, patch: patchOf(chosen[0]!) as never });
  return group(project, LABELS.changedMany(chosen.length, NOUNS_OF[kind]), (p) =>
    chosen.reduce((q, x) => updateLayer(q, { kind, id: x.id, patch: patchOf(x) as never }), p));
}

const NOUNS_OF: Record<LayerKind, string> = { zooms: 'zooms', layouts: 'layout switches', overlays: 'overlays', cards: 'cards', media: 'media files', voiceovers: 'voiceovers' };
