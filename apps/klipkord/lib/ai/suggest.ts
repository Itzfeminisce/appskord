import type { Unit } from '../wordCuts';
import type { Find } from '../project/cleanup';
import { quote } from '../project/ops';
import { secs, type QuickWin } from '../project/suggest';
import { isKept } from '../project/time';
import { currentCut } from '../project/history';
import type { AiOp, Project } from '../project/types';
import { askOps, type Call } from './ops';

/** The request behind the AI rows of SuggestedEdits. */
export const SUGGEST_REQUEST =
  'Suggest at most 3 edits that make this video tighter and clearer: cut off-topic or repeated parts, or zoom where something small is shown. ' +
  'Use only "cut" and "zoom" ops. Label each as a short instruction.';

/** AI suggestions as quick wins for T6's list: cuts become retake-style rows, zooms join a zoom row. Only kept words count. */
export function toWins(project: Project, units: Unit[], checked: { ops: AiOp[]; labels: string[] }): QuickWin[] {
  const cut = currentCut(project);
  const wins: QuickWin[] = [];
  checked.ops.forEach((op, i) => {
    const title = checked.labels[i];
    if (!title || (op.op !== 'cut' && op.op !== 'zoom')) return;
    const list = Array.from({ length: op.to - op.from + 1 }, (_, k) => op.from + k).filter((k) => isKept(cut, (units[k]!.start + units[k]!.end) / 2));
    if (!list.length) return;
    const start = units[list[0]!]!.start;
    const end = units[list[list.length - 1]!]!.end;
    const text = list.map((k) => project.wordFixes[k] ?? units[k]!.text).join(' ');
    if (op.op === 'cut') {
      const find: Find = { id: `ai-${i}`, kind: 'retake', start, end, text, units: list, saves: end - start };
      wins.push({ id: `ai-${i}`, kind: 'retake', title, detail: `${quote(text)} · saves ${secs(end - start)}`, saves: end - start, at: start, finds: [find], zooms: [] });
    } else if (op.op === 'zoom') {
      const zoom = { id: `ai-${i}`, at: start, end: Math.max(end, start + 800), depth: op.depth, focus: 'cursor' as const, feel: 'smooth' as const, auto: false };
      wins.push({ id: `ai-${i}`, kind: 'zooms', title, detail: `${quote(text)} · ${op.depth}x`, saves: 0, at: start, finds: [], zooms: [zoom] });
    }
  });
  return wins.slice(0, 3);
}

/** Asks for suggestions; any failure just means no AI rows. */
export async function aiWins(project: Project, units: Unit[], call: Call): Promise<QuickWin[]> {
  try {
    const checked = await askOps({ request: SUGGEST_REQUEST, project, units, cards: false, call });
    return toWins(project, units, checked);
  } catch {
    return [];
  }
}
