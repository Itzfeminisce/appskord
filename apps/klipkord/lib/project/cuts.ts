import { BUBBLE_SHARE } from '../bubble';
import { commit, currentCut } from './history';
import { LABELS, newId } from './ops';
import type { Camera, Clip, Cut, Look, Project, Shape, Source, VerticalFit } from './types';

/** The cut every project starts with; the name is the frame's cut switcher label. */
export const FULL_CUT_NAME = 'Full';

const RECORDED = new Set<Source['kind']>(['screen', 'camera', 'mic', 'tab', 'baked']);

/** Length of the recording itself: the latest end of any recorded source, ms. */
export function recordingLength(sources: Source[]): number {
  return sources.filter((s) => RECORDED.has(s.kind)).reduce((max, s) => Math.max(max, s.offset + s.duration), 0);
}

export const hasCamera = (sources: Source[]): boolean => sources.some((s) => s.kind === 'camera');

export const DEFAULT_CAMERA: Camera = {
  corner: 'bottom-left', size: BUBBLE_SHARE.M, shape: 'round', mirror: false,
  blur: { on: false, mode: 'blur', colour: '#1C1917' },
};
/** A recording with its camera baked in keeps its own frame; a v3 recording gets a padded one. */
export const PLAIN_LOOK: Look = {
  background: { kind: 'colour', value: '#1C1917' }, padding: 0, corners: 0, shadow: 0,
  cursor: { size: 1, smooth: true, clicks: true },
};
// Design defaults: Ember, 7% padding of a 1920 px wide frame, 10 px corners, Soft shadow.
export const DEFAULT_LOOK: Look = { ...PLAIN_LOOK, background: { kind: 'gradient', value: 'ember' }, padding: 134, corners: 10, shadow: 24 };

/** The picture for a tall shape: the camera under the screen when there is one, else follow the cursor or fit with bars. */
export function defaultFit(sources: Source[], events: boolean): VerticalFit {
  if (hasCamera(sources)) return 'stack';
  return events ? 'follow' : 'bars';
}

export interface CutInit { name: string; shape?: Shape; clips: Clip[]; made: Cut['made']; look?: Look; fit?: VerticalFit }

/** A cut with no layers and default settings. */
export function blankCut({ name, shape = '16:9', clips, made, look = DEFAULT_LOOK, fit = 'bars' }: CutInit): Cut {
  return {
    id: newId(), name, shape, fit, made, clips,
    zooms: [], layouts: [], overlays: [], cards: [], media: [], voiceovers: [],
    camera: DEFAULT_CAMERA, look,
    captions: { style: 'clean', position: 'bottom', size: 48, show: false },
    audio: { denoise: false, level: false, tabVolume: 1, voiceVolume: 1 },
    tracks: {},
  };
}

/** One clip that plays the whole recording. */
export function wholeClips(sources: Source[]): Clip[] {
  const end = recordingLength(sources);
  return end > 0 ? [{ id: newId(), in: 0, out: end, speed: 1 }] : [];
}

function addCut(project: Project, cut: Cut): Project {
  return { ...project, cuts: [...project.cuts, cut], current: cut.id, history: { ...project.history, [cut.id]: { undo: [], redo: [] } } };
}

const baked = (project: Project) => project.sources.some((s) => s.kind === 'baked');

/** "New cut from the full recording": the whole recording, no edits; it becomes the current cut. */
export function newCut(project: Project, { name, shape = '16:9', made = 'manual' }: { name: string; shape?: Shape; made?: Cut['made'] }): Project {
  const cut = blankCut({
    name: name.trim() || FULL_CUT_NAME, shape, made, clips: wholeClips(project.sources),
    look: baked(project) ? PLAIN_LOOK : DEFAULT_LOOK, fit: defaultFit(project.sources, project.events),
  });
  return addCut(project, cut);
}

/** "Duplicate": a copy of a cut with its own history; it becomes the current cut. */
export function duplicateCut(project: Project, { id, name }: { id: string; name: string }): Project {
  const from = project.cuts.find((c) => c.id === id);
  if (!from) return project;
  return addCut(project, { ...structuredClone(from), id: newId(), name: name.trim() || from.name, made: 'duplicate' });
}

/** "Rename". A blank name is ignored. */
export function renameCut(project: Project, { id, name }: { id: string; name: string }): Project {
  const clean = name.trim();
  if (!clean || !project.cuts.some((c) => c.id === id)) return project;
  return { ...project, cuts: project.cuts.map((c) => (c.id === id ? { ...c, name: clean } : c)) };
}

/** "Delete". Never the last cut; its history goes with it. */
export function deleteCut(project: Project, { id }: { id: string }): Project {
  if (project.cuts.length <= 1 || !project.cuts.some((c) => c.id === id)) return project;
  const cuts = project.cuts.filter((c) => c.id !== id);
  const { [id]: _gone, ...history } = project.history;
  void _gone;
  return { ...project, cuts, history, current: project.current === id ? cuts[0]!.id : project.current };
}

/** Switches the cut being edited. */
export function selectCut(project: Project, { id }: { id: string }): Project {
  return project.cuts.some((c) => c.id === id) && project.current !== id ? { ...project, current: id } : project;
}

/** Changes the current cut's shape (and, for a tall shape, how the picture fits). One undoable step. */
export function setShape(project: Project, { shape, fit, label }: { shape: Shape; fit?: VerticalFit; label?: string }): Project {
  const cut = currentCut(project);
  if (cut.shape === shape && (fit === undefined || cut.fit === fit)) return project;
  const next: Cut = { ...cut, shape, ...(fit && { fit }) };
  return commit(project, label ?? LABELS.shape(shape), { ...project, cuts: project.cuts.map((c) => (c.id === cut.id ? next : c)) });
}
