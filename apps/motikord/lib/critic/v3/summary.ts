// The compact recipe the critic reads: words, look and motion per scene, cut down until a call fits the budget.
import type { SlotValue } from '@appskord/scenes';
import type { ClipV3, LayerV3, LookGuide } from '@appskord/motion/types';
import type { Recipe } from '../../types';
import { sceneColours } from './checks';

export type Detail = 'full' | 'short' | 'bare';

const SLOT_CHARS = 120;
const cut = (s: string, chars: number) => (s.length > chars ? `${s.slice(0, chars)}…` : s);
const clip = (s: string, words: number, chars = SLOT_CHARS) => {
  const w = s.trim().split(/\s+/);
  return cut(w.length > words ? `${w.slice(0, words).join(' ')}…` : s.trim(), chars);
};
const slot = (v: SlotValue): string =>
  typeof v === 'string'
    ? clip(v, 14)
    : Array.isArray(v)
      ? cut(v.map((x) => (typeof x === 'string' ? clip(x, 8, 40) : 'label' in x ? `${cut(String(x.label), 40)} ${cut(String(x.value), 20)}` : '')).join(' / '), SLOT_CHARS)
      : 'media';
const id = (s: string) => cut(String(s), 24);

function layerLine(l: LayerV3): string {
  const keys = Object.values(l.tracks).flatMap((t) => t ?? []);
  const end = Math.max(0, ...keys.map((k) => k.t));
  const curve = keys.find((k) => k.curve)?.curve;
  const c = curve ? (curve.kind === 'spring' ? `spring${curve.bounce}` : 'ease') : 'linear';
  const unit = l.type ? ` per ${l.type.unit}` : '';
  return `${id(l.id)}:${l.kind}/${l.depth}@${l.start ?? 0}+${end}ms ${Object.keys(l.tracks).join(',')} ${c}${unit}${l.carry ? ' carry' : ''}`;
}

/** One line per scene, plus the look guide. `short` drops the layers' props, `bare` drops layers. */
export function summary(recipe: Recipe, v3: ClipV3, look: LookGuide, detail: Detail = 'full'): string {
  const head = `Look guide "${cut(look.name, 60)}": palette ${look.palette.slice(0, 12).map(id).join(' ')}; type ${cut(look.type.display, 40)} / ${cut(look.type.text, 40)}; feel ${look.feel}; camera ${look.camera}; light ${look.light}. ${v3.fps} fps.`;
  const scenes = v3.scenes.map((s, i) => {
    const v2 = recipe.scenes[i];
    const words = Object.entries(v2?.slots ?? {}).map(([k, v]) => `${cut(k, 24)}="${slot(v)}"`);
    const text = words.length ? words : (v2?.layers ?? []).flatMap((l) => (l.type === 'text' ? [`"${clip(l.text, 14)}"`] : []));
    const colours = [...new Set(sceneColours(recipe, i).map((c) => id(c.colour)))].join(' ');
    const fx = (s.effects ?? []).map((e) => `${e.effect} ${e.amount}`).join(', ');
    const parts = [
      `Scene ${i + 1} ${id(s.templateId)} ${s.ms}ms`,
      `words ${text.join('; ') || 'none'}`,
      `colours ${colours || 'none'}`,
      `camera ${s.camera.move} ${s.camera.amount}`,
      `next ${s.transition.kind}`,
    ];
    if (fx) parts.push(`effects ${fx}`);
    if (detail === 'full') parts.push(`layers ${s.layers.map(layerLine).join(' | ')}`);
    if (detail === 'short') parts.push(`layers ${s.layers.map((l) => `${id(l.id)}:${l.depth}@${l.start ?? 0}`).join(' ')}`);
    return parts.join('; ');
  });
  return [head, ...scenes].join('\n');
}
