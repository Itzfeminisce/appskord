import type { Aspect, Box, ClipType, SceneTemplate, StyleId, StylePack, TemplateId } from '../types';

const sceneFiles = import.meta.glob<SceneTemplate>('./scenes/*.json', { eager: true, import: 'default' });
const packFiles = import.meta.glob<StylePack>('./packs/*.json', { eager: true, import: 'default' });

// Frame order (SceneTemplates 1 to 12, StylePacks left to right); a new file sorts after these by id.
const TEMPLATE_ORDER: readonly string[] = ['title-hook', 'big-statement', 'stat-reveal', 'chart', 'quote', 'list',
  'hero', 'split', 'before-after', 'steps', 'logo-sting', 'end-card'];
const PACK_ORDER: readonly string[] = ['clean', 'bold', 'playful', 'corporate'];
const byOrder = (order: readonly string[]) => (a: { id: string }, b: { id: string }) => {
  const ia = order.indexOf(a.id);
  const ib = order.indexOf(b.id);
  return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.id.localeCompare(b.id);
};

export const SCENE_TEMPLATES: readonly SceneTemplate[] = Object.values(sceneFiles).sort(byOrder(TEMPLATE_ORDER));
export const STYLE_PACKS: readonly StylePack[] = Object.values(packFiles).sort(byOrder(PACK_ORDER));

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
