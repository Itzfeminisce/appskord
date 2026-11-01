import type { Recipe } from '../types';

/**
 * Brings a stored recipe up to the current contract. v2 only adds optional fields, so a v1 recipe loads unchanged
 * and keeps version 1 until a new look is applied; a v2 recipe is returned as it is.
 */
export function migrate(recipe: Recipe): Recipe {
  return recipe;
}

/** Marks a recipe as v2 once a look (style, pace or a template scene) is applied to it. */
export const toV2 = (recipe: Recipe): Recipe => (recipe.version === 2 ? recipe : { ...recipe, version: 2 });
