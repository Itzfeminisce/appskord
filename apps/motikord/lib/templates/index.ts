import type { ClipType, Recipe } from '../types';
import { CLIP_TYPES } from '../recipe/validate';
import { clipDuration } from '../render/drawFrame';

const files = import.meta.glob<Recipe>('./*.json', { eager: true, import: 'default' });

export interface Template { id: string; name: string; type: ClipType; lengthMs: number; scenes: number; recipe: Recipe }

/** Every bundled template, in clip type order then name. */
export const TEMPLATES: Template[] = Object.values(files)
  .map((recipe) => ({ id: recipe.id, name: recipe.name, type: recipe.type, lengthMs: clipDuration(recipe), scenes: recipe.scenes.length, recipe }))
  .sort((a, b) => CLIP_TYPES.indexOf(a.type) - CLIP_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));

export const getTemplate = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

const newId = () => globalThis.crypto?.randomUUID?.() ?? `clip-${Date.now().toString(36)}`;

/** Your own copy of a template: a new id, nothing shared with the bundled recipe. */
export function copyTemplate(template: Template, id: string = newId()): Recipe {
  return { ...structuredClone(template.recipe), id };
}

/** 0:08 style length. */
export function formatLength(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
