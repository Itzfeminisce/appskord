import type { Aspect, PatchOp, Recipe } from '../types';
import type { Edit } from './store';

// "This size only": edits to a layer's box land in Layer.boxes[aspect], so the other sizes keep their layout.

const BOX = /^(\/scenes\/(\d+)\/layers\/(\d+))\/box$/;

/** Rewrites box ops onto boxes[aspect] of the size being edited; every other op passes through. */
export function toSizeOnly(r: Recipe, edit: Edit, aspect: Aspect = r.aspect): Edit {
  // A size switch carries its own boxes for the new size; rewriting them would file them under the old one.
  if (switchesSize(edit)) return edit;
  const made = new Set<string>();
  const ops: PatchOp[] = [];
  for (const op of edit.ops) {
    const m = BOX.exec(op.path);
    if (!m || op.op === 'remove' || op.op === 'move') { ops.push(op); continue; }
    const [, layerPath, si, li] = m;
    const layer = r.scenes[Number(si)]?.layers[Number(li)];
    if (!layer) { ops.push(op); continue; }
    if (layer.boxes || made.has(layerPath!)) {
      const has = !!layer.boxes?.[aspect] || made.has(`${layerPath}/${aspect}`);
      ops.push({ op: has ? 'replace' : 'add', path: `${layerPath}/boxes/${aspect}`, value: op.value });
    } else {
      ops.push({ op: 'add', path: `${layerPath}/boxes`, value: { [aspect]: op.value } });
      made.add(layerPath!);
    }
    made.add(`${layerPath}/${aspect}`);
  }
  return made.size ? { ...edit, ops, summary: `${edit.summary} (${aspect})` } : edit;
}

/** True when the edit switches the clip to another size. */
export const switchesSize = (edit: Edit) => edit.ops.some((o) => o.path === '/aspect');
