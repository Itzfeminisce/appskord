import { autoFix, type CheckOptions } from '../checker';
import { applyPatch } from '../patch';
import { boxFor } from '../render/reflow';
import { getSceneTemplate } from '../templates/scenes';
import type { Aspect, CriticNote, Issue, PatchOp, Recipe } from '../types';
import type { Edit } from './store';
import { slotCount } from './v2';

// CheckerV2: "Fixed for you" lines (each fix one Change by the quality check) and the layout cards' words.

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sceneNo = (r: Recipe, sceneId: string) => r.scenes.findIndex((s) => s.id === sceneId) + 1;
const NUMBER = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const WIDTH: Record<Aspect, number> = { '9:16': 1080, '1:1': 1080, '16:9': 1920 };

/** The "Fixed for you" line: "Scene 2 headline cut to 6 words" and, on its own line, why. */
export function fixedLine(issue: Issue, before: Recipe): string {
  if (issue.kind === 'words') {
    const scene = before.scenes.find((s) => s.id === issue.sceneId);
    const def = scene?.template ? getSceneTemplate(scene.template)?.slots.find((d) => d.id === issue.layerId) : undefined;
    if (scene && def?.words !== undefined) {
      const n = slotCount(def, scene.slots?.[def.id]).n;
      return `Scene ${sceneNo(before, scene.id)} ${lower(def.name)} cut to ${def.words} words\nWas ${n} words. The slot holds ${def.words}.`;
    }
  }
  return issue.note ?? '';
}

/** "Check again": the checker's safe fixes, each its own Change so each line has its own Undo. */
export function autoFixEdits(r: Recipe, opts: CheckOptions = {}): Edit[] {
  const { fixed } = autoFix(r, opts);
  const out: Edit[] = [];
  let cur = r;
  for (const issue of fixed) {
    out.push({ ops: issue.fix, summary: fixedLine(issue, cur) });
    cur = applyPatch(cur, issue.fix).doc;
  }
  return out;
}

export interface LayoutText { title: string; body: string; action: string }

/** Words on a layout card (overlap, crowding, empty, align, words); undefined for other kinds. */
export function layoutText(kind: Issue['kind'], r: Recipe, sceneId: string, layerId: string, aspect: Aspect, fix: PatchOp[], note = ''): LayoutText | undefined {
  const n = sceneNo(r, sceneId);
  const scene = r.scenes[n - 1];
  const what = note.replace(/ in scene \d+$/, '').replace(/^Scene \d+ /, '');
  switch (kind) {
    case 'overlap': {
      // The checker words a logo it can move as done ("logo moved off the head"); the card still names the problem.
      const moved = /^logo moved off the (.+)$/.exec(what);
      const m = moved ? ['', 'Logo', moved[1]!] : /^(.+?) overlaps (.+)$/.exec(what);
      const logo = m?.[1] === 'Logo';
      return { title: m ? `${m[1]} overlaps the ${m[2]}` : what, body: '', action: logo ? 'Move logo' : `Use the ${aspect} layout` };
    }
    case 'crowding': {
      const texts = scene?.layers.filter((l) => l.type === 'text') ?? [];
      const at = texts.findIndex((l) => l.id === layerId);
      return {
        title: `Scene ${n} is crowded`,
        body: `${NUMBER[texts.length] ?? texts.length} lines in a small space.`,
        action: at >= 0 && at < ORDINAL.length ? `Drop the ${ORDINAL[at]} line` : 'Drop the last line',
      };
    }
    case 'empty':
      return { title: `Scene ${n} is mostly empty at ${aspect}`, body: aspect === '16:9' ? 'Both sides of the frame are bare.' : '', action: `Use the ${aspect} layout` };
    case 'align': {
      const m = /^(.+?) lined up with (?:the )?(.+)$/.exec(what);
      const layer = scene?.layers.find((l) => l.id === layerId);
      const v = (fix[0] as { value?: Record<string, unknown> } | undefined)?.value;
      const to = (typeof v?.x === 'number' ? v : (v?.[aspect] as { x?: number } | undefined))?.x as number | undefined;
      const from = layer ? boxFor(layer, aspect, r.aspect, scene!.layout).x : undefined;
      const px = to !== undefined && from !== undefined ? Math.round((from - to) * WIDTH[aspect]) : 0;
      const centred = layer?.type === 'text' && layer.align === 'center';
      const b = m?.[1] ? lower(m[1]) : 'text';
      return {
        title: m ? `${cap(m[2]!)} and ${b} don't line up` : what,
        body: px ? `The ${b} starts ${Math.abs(px)} px further ${px > 0 ? 'right' : 'left'}.` : '',
        action: centred ? 'Align centre' : 'Align left',
      };
    }
    case 'words':
      return { title: 'Too long for this slot', body: note, action: 'Shorten now' };
    default:
      return undefined;
  }
}

/** template-repeat: the run of scenes (from 1) ending at this one that share its template, and the template's name. */
export function repeatRun(r: Recipe, sceneId: string): { scenes: number[]; template: string } {
  const i = r.scenes.findIndex((s) => s.id === sceneId);
  const t = r.scenes[i]?.template;
  let start = i;
  while (start > 0 && t && r.scenes[start - 1]!.template === t) start--;
  return { scenes: Array.from({ length: i - start + 1 }, (_, k) => start + k + 1), template: (t && getSceneTemplate(t)?.name) ?? '' };
}

/** Critic notes still about a scene the clip has. */
export const liveNotes = (notes: readonly CriticNote[], r: Recipe): CriticNote[] => notes.filter((x) => r.scenes[x.sceneIndex]);

/** How many things Check asks you to look at: layout cards plus live critic notes. The badge and the panel headline both use it. */
export const toLookAt = (cards: number, notes: readonly CriticNote[], r: Recipe): number => cards + liveNotes(notes, r).length;
