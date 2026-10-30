import { getPreset } from '../render/presets';
import { clipDuration } from '../render/drawFrame';
import type { Author, Change, PresetSlot, Recipe } from '../types';

// The Changes tab: every Change newest first, who made it, and how far "Go back here" undoes.

export const newestFirst = (past: readonly Change[]): Change[] => [...past].reverse();

/** "Groq", "built-in AI" or "by hand", as the Changes tab shows the author. */
export function byLabel(by: Author): string | undefined {
  switch (by) {
    case 'groq': return 'Groq';
    case 'builtin': return 'built-in AI';
    case 'hand': return 'by hand';
    case 'template': return undefined;
  }
}

/** "Just now", then "N min ago". */
export function agoLabel(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  return min < 1 ? 'Just now' : `${min} min ago`;
}

/** "Just now · Groq". */
export function metaLine(c: Change, now: number): string {
  const who = byLabel(c.by);
  return who ? `${agoLabel(c.at, now)} · ${who}` : agoLabel(c.at, now);
}

/** How many undos bring the clip back to just after this change; undefined when it is not in the history. */
export function stepsBack(past: readonly Change[], changeId: string): number | undefined {
  const i = past.findIndex((c) => c.id === changeId);
  return i < 0 ? undefined : past.length - 1 - i;
}

/** A prompt change is stored as “prompt” and, on its own line, what it did. */
export function promptSummary(prompt: string, detail: string): string {
  const head = `“${prompt.trim()}”`;
  return detail ? `${head}\n${detail}` : head;
}
export function splitSummary(summary: string): { title: string; detail?: string } {
  const i = summary.indexOf('\n');
  return i < 0 ? { title: summary } : { title: summary.slice(0, i), detail: summary.slice(i + 1) };
}

const SLOTS: readonly PresetSlot[] = ['in', 'during', 'out'];
const label = (id?: string) => (id ? getPreset(id)?.label ?? id : undefined);

/** What a prompt changed, in the Changes tab's words: "Title: Rise → Bounce. Clip is now 15 s." */
export function describe(before: Recipe, after: Recipe): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  after.scenes.forEach((scene) => scene.layers.forEach((l) => {
    const old = before.scenes.find((s) => s.id === scene.id)?.layers.find((x) => x.id === l.id);
    if (!old) return;
    for (const slot of SLOTS) {
      const a = label(old[slot]?.preset);
      const b = label(l[slot]?.preset);
      const line = a && b && a !== b ? `${l.name}: ${a} → ${b}.` : undefined;
      if (line && !seen.has(line)) { seen.add(line); parts.push(line); }
    }
  }));
  const was = clipDuration(before);
  const now = clipDuration(after);
  if (was !== now) parts.push(`Clip is now ${Math.round(now / 1000)} s.`);
  return parts.join(' ');
}
