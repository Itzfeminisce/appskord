import type { Aspect, Box, ClipType, SceneTemplate, StyleId, StylePack, TemplateId } from '../types';

import beforeAfter from './scenes/before-after.json';
import bigStatement from './scenes/big-statement.json';
import chart from './scenes/chart.json';
import endCard from './scenes/end-card.json';
import hero from './scenes/hero.json';
import list from './scenes/list.json';
import logoSting from './scenes/logo-sting.json';
import quote from './scenes/quote.json';
import split from './scenes/split.json';
import statReveal from './scenes/stat-reveal.json';
import steps from './scenes/steps.json';
import titleHook from './scenes/title-hook.json';
import boldPack from './packs/bold.json';
import cleanPack from './packs/clean.json';
import corporatePack from './packs/corporate.json';
import playfulPack from './packs/playful.json';

// Explicit imports, not import.meta.glob, so the package runs under any bundler; a new file is added here.
const sceneFiles = [
  beforeAfter,
  bigStatement,
  chart,
  endCard,
  hero,
  list,
  logoSting,
  quote,
  split,
  statReveal,
  steps,
  titleHook,
] as unknown as SceneTemplate[];
const packFiles = [boldPack, cleanPack, corporatePack, playfulPack] as unknown as StylePack[];

// Frame order (SceneTemplates 1 to 12, StylePacks left to right); a new file sorts after these by id.
const TEMPLATE_ORDER: readonly string[] = [
  'title-hook',
  'big-statement',
  'stat-reveal',
  'chart',
  'quote',
  'list',
  'hero',
  'split',
  'before-after',
  'steps',
  'logo-sting',
  'end-card',
];
const PACK_ORDER: readonly string[] = ['clean', 'bold', 'playful', 'corporate'];
const byOrder = (order: readonly string[]) => (a: { id: string }, b: { id: string }) => {
  const ia = order.indexOf(a.id);
  const ib = order.indexOf(b.id);
  return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.id.localeCompare(b.id);
};

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [...sceneFiles].sort(byOrder(TEMPLATE_ORDER));
export const STYLE_PACKS: readonly StylePack[] = [...packFiles].sort(byOrder(PACK_ORDER));

export const getSceneTemplate = (id: string): SceneTemplate | undefined => SCENE_TEMPLATES.find((t) => t.id === id);
export const getPack = (id: string): StylePack | undefined => STYLE_PACKS.find((p) => p.id === id);
export const isTemplateId = (id: unknown): id is TemplateId => typeof id === 'string' && !!getSceneTemplate(id);
export const isStyleId = (id: unknown): id is StyleId => typeof id === 'string' && !!getPack(id);

/** The pack "Auto" picks for a clip type: the one whose `clipTypes` lists it, else Clean. */
export function autoStyle(type: ClipType): StyleId {
  return STYLE_PACKS.find((p) => p.clipTypes.includes(type))?.id ?? 'clean';
}

/** Template safe area (TemplateAspects): 9:16 7% sides, 10% top, 16% bottom; 1:1 6%; 16:9 5% sides, 6% top and bottom. */
export const SAFE_AREA: Record<Aspect, Box> = {
  '9:16': { x: 0.07, y: 0.1, w: 0.86, h: 0.74 },
  '1:1': { x: 0.06, y: 0.06, w: 0.88, h: 0.88 },
  '16:9': { x: 0.05, y: 0.06, w: 0.9, h: 0.88 },
};

/** A media slot that fills the frame is a background, so it may run under the safe area. */
export const isBackgroundBox = (b: Box) => b.x <= 0 && b.y <= 0 && b.w >= 1 && b.h >= 1;

export function insideSafeArea(b: Box, aspect: Aspect): boolean {
  const s = SAFE_AREA[aspect];
  const e = 1e-6;
  return b.x >= s.x - e && b.y >= s.y - e && b.x + b.w <= s.x + s.w + e && b.y + b.h <= s.y + s.h + e;
}
