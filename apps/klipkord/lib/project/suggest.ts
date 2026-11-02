import type { Segment } from '../types';
import { autoZoom } from './autoZoom';
import { cleanEdit, DEFAULT_CLEANUP, FILLER_ORDER, findAll, PAUSE_SPEED, timeSaved, type Find } from './cleanup';
import { currentCut, group } from './history';
import { addLayer, LABELS } from './ops';
import { cutLength } from './time';
import type { Feel, Project, RecEvent, Zoom } from './types';

export type QuickWinKind = 'fillers' | 'retake' | 'pauses' | 'zooms';

/** One row of SuggestedEdits. `at` is the rec ms "Show me" plays from. */
export interface QuickWin { id: string; kind: QuickWinKind; title: string; detail: string; saves: number; at: number; finds: Find[]; zooms: Zoom[] }

const FEEL_NAMES: Record<Feel, string> = { calm: 'Calm', smooth: 'Smooth', snappy: 'Snappy' };

/** "9 s"; under 10 s keeps one decimal: "1.5 s". */
export function secs(ms: number): string {
  const s = ms / 1000;
  return s >= 10 ? `${Math.round(s)} s` : `${Number(s.toFixed(1))} s`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
/** The opening words of a sentence for "You said “Click Invite…” twice." */
const opening = (text: string) => `“${text.trim().split(/\s+/).slice(0, 2).join(' ').replace(/[.,!?…]+$/, '')}…”`;

function fillerWin(fillers: Find[]): QuickWin | null {
  if (!fillers.length) return null;
  const said = new Set(fillers.map((f) => f.text.toLowerCase().replace(/[^a-z' ]/g, '').trim()));
  const names = FILLER_ORDER.filter((w) => said.has(w)).join(', ');
  const saves = timeSaved(fillers);
  return {
    id: 'fillers', kind: 'fillers', title: `Remove ${many(fillers.length, 'filler word')}`, detail: `${capital(names)} · saves ${secs(saves)}`,
    saves, at: fillers[0]!.start, finds: fillers, zooms: [],
  };
}

function retakeWin(retakes: Find[]): QuickWin | null {
  if (!retakes.length) return null;
  const saves = timeSaved(retakes);
  const one = retakes[0]!;
  return {
    id: 'retakes', kind: 'retake', title: retakes.length === 1 ? `Cut a ${secs(saves)} retake` : `Cut ${many(retakes.length, 'retake')}`,
    detail: retakes.length === 1 ? `You said ${opening(one.text)} twice. Keeps the last.` : `Sentences said twice, keeps the last · saves ${secs(saves)}`,
    saves, at: one.start, finds: retakes, zooms: [],
  };
}

function pauseWin(pauses: Find[]): QuickWin | null {
  if (!pauses.length) return null;
  const saves = timeSaved(pauses);
  return {
    id: 'pauses', kind: 'pauses', title: `Speed up ${many(pauses.length, 'long pause')}`,
    detail: `Plays them at ${PAUSE_SPEED}x instead of cutting · saves ${secs(saves)}`, saves, at: pauses[0]!.start, finds: pauses, zooms: [],
  };
}

function zoomWin(zooms: Zoom[]): QuickWin | null {
  if (!zooms.length) return null;
  const depth = Number((zooms.reduce((n, z) => n + z.depth, 0) / zooms.length).toFixed(1));
  const feel = FEEL_NAMES[zooms[0]!.feel];
  const follows = zooms.every((z) => z.focus === 'cursor') ? ', follows the cursor' : '';
  return {
    id: 'zooms', kind: 'zooms', title: `Add ${many(zooms.length, 'zoom')} on your clicks`, detail: `${feel}, ${depth}x${follows}`,
    saves: 0, at: zooms[0]!.at, finds: [], zooms,
  };
}

/** Local quick wins for a recording: fillers, each retake, long pauses (sped up) and, with an events track, zooms on clicks. */
export function quickWins(project: Project, segments: Segment[], events?: RecEvent[], duration?: number): QuickWin[] {
  const cut = currentCut(project);
  const finds = findAll(segments, cut, { ...DEFAULT_CLEANUP, pauseAction: 'speed' }, project.wordFixes);
  // A filler or pause inside a retake goes with the retake.
  const inRetake = (f: Find) => finds.retakes.some((r) => f.start >= r.start && f.end <= r.end);
  const hasAuto = cut.zooms.some((z) => z.auto);
  const zooms = events && !hasAuto ? autoZoom(events, 'smooth', duration) : [];
  return [
    fillerWin(finds.fillers.filter((f) => !inRetake(f))),
    retakeWin(finds.retakes),
    pauseWin(finds.pauses.filter((f) => !inRetake(f))),
    zoomWin(zooms),
  ].filter((w): w is QuickWin => w !== null);
}

/** The edit of one quick win, with no history step of its own. */
function winEdit(project: Project, win: QuickWin): Project {
  if (win.kind === 'zooms') return addLayer(project, { kind: 'zooms', items: win.zooms });
  return cleanEdit(project, win.finds, win.kind === 'pauses' ? 'speed' : 'cut');
}

/** "Apply": one quick win as one Undo step. */
export function applyWin(project: Project, win: QuickWin): Project {
  return group(project, LABELS.quickWin(win.title), (p) => winEdit(p, win));
}

/** "Apply all N": every quick win as one Undo step. */
export function applyWins(project: Project, wins: QuickWin[]): Project {
  if (!wins.length) return project;
  return group(project, LABELS.quickWins(wins.length), (p) => wins.reduce(winEdit, p));
}

/** The cut's length before and after the quick wins, ms. */
export function lengths(project: Project, wins: QuickWin[]): { before: number; after: number } {
  const before = cutLength(currentCut(project));
  const after = cutLength(currentCut(wins.reduce(winEdit, project)));
  return { before, after };
}

/** SuggestedEdits closed: it does not open by itself again; PanelOpen's card still reaches it. */
export function seeQuickWins(project: Project): Project {
  return project.quickWins === 'seen' ? project : { ...project, quickWins: 'seen' };
}
