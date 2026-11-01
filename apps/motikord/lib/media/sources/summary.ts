import type { MediaSettings } from '../../types';
import { BUILTINS, isOn } from './builtins';

/** Key shapes for the "This is a {source} key · Ready" line. Loose on purpose: the source itself is the real check. */
export const KEY_SHAPES: Partial<Record<string, RegExp>> = {
  pexels: /^[A-Za-z0-9]{40,64}$/, pixabay: /^\d+-[0-9a-f]{20,40}$/i, freesound: /^[A-Za-z0-9]{30,50}$/,
  jamendo: /^[0-9a-f]{8}$/i, unsplash: /^[A-Za-z0-9_-]{40,50}$/,
};

/** Settings' "Media sources" row: "Openverse, Wikimedia Commons, NASA, Pexels and 1 of your own" and the count that is on. */
export function sourcesSummary(media: MediaSettings, keys: Record<string, string | undefined>): { line: string; on: number } {
  const names = BUILTINS.filter((b) => isOn(media.on, b) && (!b.key || !!keys[b.key.name])).map((b) => b.short);
  const own = media.custom.filter((c) => c.on).length;
  const on = names.length + own;
  if (own) return { line: `${names.join(', ')}${names.length ? ' and ' : ''}${own} of your own`, on };
  return { line: names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '', on };
}
