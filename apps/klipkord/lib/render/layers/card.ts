import type { BrandKit, BrandRecord } from '@appskord/brand';
import {
  drawScene as scenesDrawScene, getPack, getSceneTemplate, isStyleId, isTemplateId, loadSceneFonts, SCENE_FONTS,
  type Aspect, type SceneCache, type SceneSpec, type TemplateId,
} from '@appskord/scenes';
import { toOut } from '../../project/time';
import type { Card, Cut } from '../../project/types';
import type { DrawCard } from './cards';
import type { Ctx2D } from './path';

/** The cards the Text and cards panel offers, from Motikord's scene templates. */
export const CARD_TEMPLATES = ['title-hook', 'end-card', 'logo-sting'] as const satisfies readonly TemplateId[];
export type CardTemplate = (typeof CARD_TEMPLATES)[number];
/** Klipkord's style packs are the scenes packs of the same id. */
export const CARD_PACKS = ['clean', 'bold', 'playful'] as const satisfies readonly Card['pack'][];

// The one text slot each card needs; the others are optional.
const MAIN_SLOT: Record<CardTemplate, string> = { 'title-hook': 'headline', 'end-card': 'cta', 'logo-sting': '' };

export interface CardSlot { id: string; name: string; words: number; optional: boolean }

/** The text slots a person fills, in the template's order; logos come from the brand kit. */
export function cardSlots(template: string): CardSlot[] {
  const tpl = getSceneTemplate(template);
  if (!tpl) return [];
  const main = (MAIN_SLOT as Record<string, string | undefined>)[template];
  return tpl.slots.filter((s) => s.kind === 'text').map((s) => ({ id: s.id, name: s.name, words: s.words ?? 8, optional: s.id !== main }));
}

/** The template's name ("Title hook"), else the id in words. */
export const cardTemplateName = (template: string): string => getSceneTemplate(template)?.name ?? template.replace(/[-_]+/g, ' ');
/** The template's own length, ms. */
// The panel's logo sting is a short beat, shorter than the template's default.
export const LOGO_STING_MS = 1500;
export const cardDefaultMs = (template: string): number =>
  template === 'logo-sting' ? LOGO_STING_MS : (getSceneTemplate(template)?.defaultMs ?? 3000);

/** Keeps the first `words` words, leaving a trailing space so typing the next word still works. */
export function capWords(text: string, words: number): string {
  const parts = text.match(/\S+\s*/g) ?? [];
  return parts.length > words ? parts.slice(0, words).join('').trimEnd() : text;
}

/** The scenes size nearest the frame's shape (4:5 draws as 1:1). */
export function sceneAspect(w: number, h: number): Aspect {
  const r = w / h;
  return r > 1.3 ? '16:9' : r < 0.7 ? '9:16' : '1:1';
}

/** A kit worth drawing with: one that sets a colour, a font or a logo. */
const usable = (kit: BrandKit | undefined): BrandKit | undefined =>
  kit && (kit.colours.length || kit.headingFont || kit.bodyFont || kit.logoAssetId) ? kit : undefined;

/** The scene a card draws, or null when its template or pack is unknown. */
export function sceneSpec(card: Card, brand?: BrandKit): SceneSpec | null {
  if (!isTemplateId(card.template) || !isStyleId(card.pack)) return null;
  const kit = usable(brand);
  return { template: card.template, slots: card.slots, look: { style: card.pack, ...(kit && { brand: kit }) }, durationMs: card.ms };
}

export type DrawScene = (ctx: Ctx2D, spec: SceneSpec, aspect: Aspect, tMs: number, cache?: SceneCache) => void;

/**
 * The renderer's `drawCard` hook built on `drawScene`: the card covers the whole frame for its `ms`.
 * `startOf`: the card's start in output time (cards anchor to recording time; the cut maps it).
 */
export function drawCardWith(
  drawScene: DrawScene, startOf: (card: Card) => number | null, brand: () => BrandKit | undefined = () => undefined, cache?: SceneCache,
): DrawCard {
  return (ctx, card, info) => {
    const start = startOf(card);
    const spec = sceneSpec(card, brand());
    if (start === null || !spec || info.frame.h <= 0) return;
    drawScene(ctx, spec, sceneAspect(info.frame.w, info.frame.h), Math.max(0, info.out - start), cache);
  };
}

/** The hook the preview and export pass the renderer, drawing with `@appskord/scenes`. */
export const drawCard = (startOf: (card: Card) => number | null, brand?: () => BrandKit | undefined, cache?: SceneCache): DrawCard =>
  drawCardWith(scenesDrawScene, startOf, brand, cache);

/** Output start of each card in a plan, for a renderer that only sees plans (the preview worker). */
export function cardStarts(cut: Cut, cards: readonly Card[]): Record<string, number> {
  const starts: Record<string, number> = {};
  for (const c of cards) {
    const at = toOut(cut, c.at);
    if (at !== null) starts[c.id] = at;
  }
  return starts;
}

const PACK_FAMILIES = new Set(CARD_PACKS.flatMap((id) => Object.values(getPack(id)?.fonts ?? {})));
/** The faces the three packs draw with; the extension ships them in public/fonts. */
export const CARD_FONTS = SCENE_FONTS.filter((f) => PACK_FAMILIES.has(f.family));

interface FontSet { add(face: FontFace): unknown; check(font: string): boolean }

/** What a worker keeps for cards: the pack fonts (loaded on first use), the brand kit and its decoded logo. */
export interface CardAssets {
  cache: SceneCache;
  brand(): BrandKit | undefined;
  setBrand(record: BrandRecord | null): Promise<void>;
  /** Loads the pack fonts once; later calls share the load. */
  fonts(): Promise<void>;
}

const LOGO_ID = 'brand-logo';

export function cardAssets(fontSet: FontSet, baseUrl: string): CardAssets {
  const images = new Map<string, CanvasImageSource>();
  let kit: BrandKit | undefined;
  let loading: Promise<void> | null = null;
  let version = 0;
  return {
    cache: {
      image: (id) => images.get(id),
      fontReady(family, weight) {
        try {
          return fontSet.check(`${weight} 16px "${family.replace(/"/g, '')}"`);
        } catch {
          return false;
        }
      },
    },
    brand: () => kit,
    async setBrand(record) {
      const mine = ++version;
      const next = record ? { ...record.kit, ...(record.logo && { logoAssetId: record.kit.logoAssetId ?? LOGO_ID }) } : undefined;
      let logo: ImageBitmap | null = null;
      if (record?.logo) {
        try {
          logo = await createImageBitmap(await (await fetch(record.logo)).blob());
        } catch (error) {
          console.error('Klipkord: could not read the brand logo', error);
        }
      }
      if (mine !== version) return logo?.close();
      for (const img of images.values()) (img as ImageBitmap).close?.();
      images.clear();
      if (logo && next?.logoAssetId) images.set(next.logoAssetId, logo);
      // A kit whose logo did not decode draws without one.
      if (next && !logo) delete next.logoAssetId;
      kit = next;
    },
    fonts() {
      loading ??= loadSceneFonts(fontSet, baseUrl, CARD_FONTS).catch((error: unknown) => console.error('Klipkord: could not load card fonts', error));
      return loading;
    },
  };
}
