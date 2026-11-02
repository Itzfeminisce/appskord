import type { Unit } from '../wordCuts';
import { newCut, deleteCut, recordingLength, selectCut } from '../project/cuts';
import { currentCut, group } from '../project/history';
import { editCut, LABELS, removeRec } from '../project/ops';
import { cutLength, spans } from '../project/time';
import type { AiOp, Project } from '../project/types';
import { applyOp, type Checked } from './ops';

type NewCut = Extract<AiOp, { op: 'newCut' }>;

export const newCutOf = (ops: AiOp[]): NewCut | undefined => ops.find((o): o is NewCut => o.op === 'newCut');

/** Recording ms of each kept part, from the first word's start to the last word's end. */
export function keptParts(units: Unit[], keep: NewCut['keep']): { start: number; end: number }[] {
  return keep.map((k) => ({ start: units[k.from]!.start, end: units[k.to]!.end })).sort((a, b) => a.start - b.start);
}

/**
 * Highlights: a new cut of only the kept words, in the shape asked for, then the reply's other ops on it, as one
 * Undo step of that cut. It becomes the current cut; the cut it came from is unchanged.
 */
export function makeHighlight(project: Project, units: Unit[], checked: Pick<Checked, 'ops'>): Project {
  const spec = newCutOf(checked.ops);
  if (!spec) return project;
  const made = newCut(project, { name: spec.name, shape: spec.shape, made: 'highlight' });
  const parts = keptParts(units, spec.keep);
  const end = recordingLength(project.sources);
  return group(made, LABELS.highlight(spec.name), (p) => {
    let at = 0;
    const gaps: [number, number][] = [];
    for (const part of parts) { if (part.start > at) gaps.push([at, part.start]); at = Math.max(at, part.end); }
    if (at < end) gaps.push([at, end]);
    const trimmed = editCut(p, '', (c) => {
      const clips = gaps.reduce((list, [a, b]) => removeRec(list, a, b), c.clips);
      return clips === c.clips || !clips.length ? c : { ...c, clips };
    });
    return checked.ops.filter((o) => o.op !== 'newCut').reduce((q, op) => applyOp(q, units, op), trimmed);
  });
}

/** "Discard": the highlight cut goes and the cut it came from is current again. */
export function discardHighlight(project: Project, { id, back }: { id: string; back: string }): Project {
  return selectCut(deleteCut(project, { id }), { id: back });
}

/** What the Highlights panel lists: the new cut's length and each kept part's start in it, output ms. */
export function highlightFacts(project: Project): { length: number; starts: number[] } {
  const cut = currentCut(project);
  const starts: number[] = [];
  let last = -Infinity;
  for (const s of spans(cut)) {
    if (s.clip.in - last > 1) starts.push(s.start);
    last = s.clip.out;
  }
  return { length: cutLength(cut), starts };
}
