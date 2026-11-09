// The one automatic fix a scene gets. Each returns a new recipe and clip, or undefined when the kind asks instead.
import type { ClipV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import type { Recipe } from '../../types';
import { allowedColours, PLASTIC_AMOUNT, sceneColours, stiffLines, type QualityNote } from './checks';

export const OVERLAP_MS = 40;
const SOFT_GLOW = 0.4;

export interface FixInput {
  recipe: Recipe;
  clip: ClipV3;
  look: LookGuide;
  brandColours?: readonly string[];
}
export interface Fixed {
  sceneIndex: number;
  kind: QualityNote['kind'];
  /** "Scene 4 headline now overlaps by 40 ms". */
  line: string;
  /** "Undo" puts these back. */
  before: { recipe: Recipe; clip: ClipV3 };
}

const rgb = (c: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
/** The guide colour nearest a colour; the first guide colour for anything that isn't #RRGGBB. */
export function nearest(colour: string, palette: readonly string[]): string {
  const a = rgb(colour);
  if (!a) return palette[0]!;
  let best = palette[0]!;
  let bestD = Infinity;
  for (const p of palette) {
    const b = rgb(p);
    if (!b) continue;
    const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (d < bestD) [best, bestD] = [p, d];
  }
  return best;
}

const lastT = (l: SceneV3['layers'][number]) => Math.max(0, ...Object.values(l.tracks).map((t) => t?.at(-1)?.t ?? 0));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

function withScene(clip: ClipV3, i: number, f: (s: SceneV3) => SceneV3): ClipV3 {
  return { ...clip, scenes: clip.scenes.map((s, j) => (j === i ? f(structuredClone(s)) : s)) };
}

/** Applies the fix for a note; undefined when it is a question for the user. */
export function applyFix(n: QualityNote, x: FixInput): { recipe: Recipe; clip: ClipV3; line: string } | undefined {
  const i = n.sceneIndex;
  const scene = x.clip.scenes[i];
  if (!scene) return undefined;
  const sn = `Scene ${i + 1}`;
  switch (n.kind) {
    case 'stiff': {
      const ids = stiffLines(scene);
      if (ids.length < 2) return undefined;
      const clip = withScene(x.clip, i, (s) => {
        let at = s.layers.find((l) => l.id === ids[0])!.start ?? 0;
        let prev = s.layers.find((l) => l.id === ids[0])!;
        for (const id of ids.slice(1)) {
          const l = s.layers.find((y) => y.id === id)!;
          at = Math.min(s.ms - 1, at + Math.max(OVERLAP_MS, lastT(prev) - OVERLAP_MS));
          l.start = at;
          prev = l;
        }
        return s;
      });
      const v2 = x.recipe.scenes[i]?.layers.find((l) => l.id === ids[1]);
      const name = (v2?.name ?? 'text').toLowerCase();
      return { recipe: x.recipe, clip, line: `${sn} ${name} now overlaps by ${OVERLAP_MS} ms` };
    }
    case 'flat': {
      const move = x.look.camera === 'hold' ? 'push-in' : x.look.camera;
      const clip = withScene(x.clip, i, (s) => {
        s.camera = move === 'rack-focus' ? { move: 'push-in', amount: 0.04 } : { move, amount: 0.04 };
        for (const l of s.layers) l.depth = l.kind === 'media' || l.kind === 'shape' ? 'back' : 'front';
        return s;
      });
      return { recipe: x.recipe, clip, line: n.problem };
    }
    case 'camera': {
      const amount = median(x.clip.scenes.filter((_, j) => j !== i).map((s) => s.camera.amount));
      const clip = withScene(x.clip, i, (s) => {
        s.camera = { ...s.camera, move: x.look.camera, amount: x.look.camera === 'hold' ? 0 : amount };
        if (s.camera.move !== 'rack-focus') delete s.camera.focus;
        else if (!s.camera.focus) s.camera = { move: 'hold', amount: 0 };
        return s;
      });
      return { recipe: x.recipe, clip, line: n.problem };
    }
    case 'plastic': {
      const clip = withScene(x.clip, i, (s) => {
        for (const e of s.effects ?? []) if ((e.effect === 'glow' || e.effect === 'bloom') && e.amount > PLASTIC_AMOUNT) e.amount = SOFT_GLOW;
        return s;
      });
      return { recipe: x.recipe, clip, line: n.problem };
    }
    case 'colour': {
      const ok = allowedColours(x.look, x.brandColours);
      const off = new Set(sceneColours(x.recipe, i).filter((c) => !ok.has(c.colour.trim().toUpperCase())).map((c) => c.layerId));
      if (!off.size) return undefined;
      const recipe = structuredClone(x.recipe);
      for (const l of recipe.scenes[i]!.layers) {
        if (!off.has(l.id)) continue;
        if (l.type === 'text') l.colour = nearest(l.colour, x.look.palette);
        if (l.type === 'shape') l.fill = nearest(l.fill, x.look.palette);
      }
      return { recipe, clip: x.clip, line: n.problem };
    }
    default:
      return undefined;
  }
}
