import { contrastRatio } from './checker';
import { getBrandKit, updateClip } from './db';
import { record } from './editor/history';
import { deleteMedia, getMedia, mediaPath, putMedia } from './media';
import { canvasSize, safeBox } from './render/reflow';
import type { Asset, BrandKit, Layer, PatchOp, Recipe, Scene } from './types';

type Role = BrandKit['colours'][number]['role'];

/** The role names as BrandKit shows them. */
export const ROLE_LABEL: Record<Role, string> = { text: 'Text', primary: 'Main', accent: 'Accent', background: 'Background' };
export const ROLES: readonly Role[] = ['text', 'primary', 'accent', 'background'];
export const BUILT_IN_FONT = 'Geist';
/** Only these two can be removed; Text and Main can only be changed. */
export const REMOVABLE: readonly Role[] = ['accent', 'background'];
/** What a colour starts as when it is added to a free role. */
export const ROLE_START: Record<Role, string> = { text: '#111114', primary: '#BE185D', accent: '#FDE68A', background: '#FFFFFF' };

export const emptyKit = (): BrandKit => ({ colours: [], useForNewClips: false });

// ---- Where brand files live in OPFS ----

const slug = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'font';
export const fontAssetId = (family: string) => `brand-font-${slug(family)}`;
export const fontPath = (family: string) => mediaPath(fontAssetId(family), '');
/** The logo's asset id carries its extension ("brand-logo-svg"), so the file is found from the kit alone. */
export const logoExt = (assetId: string) => assetId.replace(/^brand-logo-/, '');
export const logoPath = (assetId: string) => mediaPath('brand-logo', logoExt(assetId));
export const logoName = (assetId: string) => `logo.${logoExt(assetId)}`;
const MIME: Record<string, string> = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** "Fraunces-Bold.ttf" becomes "Fraunces Bold". */
export const familyFromFile = (name: string) => name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Your font';

// ---- Colour picker maths (pure) ----

/** "#abc", "abc" or "#AABBCC" as "#AABBCC"; undefined when it is not a hex colour. */
export function normHex(input: string): string | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return undefined;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return `#${h.toUpperCase()}`;
}

/** Hue 0-360, saturation and value 0-1. */
export type Hsv = [number, number, number];

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}

export function hsvToHex([h, s, v]: Hsv): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `#${[5, 3, 1].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** The kit with this role's colour set, added or removed, kept in role order. */
export function withColour(kit: BrandKit, role: Role, hex: string | undefined): BrandKit {
  const rest = kit.colours.filter((c) => c.role !== role);
  const colours = hex ? [...rest, { hex, role }] : rest;
  return { ...kit, colours: colours.sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role)) };
}

/** Whether Apply has anything to apply. */
export const hasBrand = (kit: BrandKit) => !!kit.logoAssetId || kit.colours.length > 0;

// ---- Applying a kit: PatchOp[] only ----

const same = (a: string | undefined, b: string) => a?.toUpperCase() === b.toUpperCase();
const readable = (bg: string) => ((contrastRatio('#FFFFFF', bg) ?? 21) >= (contrastRatio('#111114', bg) ?? 0) ? '#FFFFFF' : '#111114');
const thin = (l: Layer) => Math.min(l.box.w, l.box.h) < 0.03;

/**
 * Ops that give the clip the kit's colours (by role), fonts (headings for titles, body for the rest) and logo.
 * Only values that differ become ops, and brandApplied is set. Pure.
 */
export function applyBrand(recipe: Recipe, kit: BrandKit): PatchOp[] {
  const ops: PatchOp[] = [];
  const colour = (role: Role) => kit.colours.find((c) => c.role === role)?.hex;
  const set = (path: string, has: boolean, current: string | undefined, value: string | undefined) => {
    if (value && !same(current, value)) ops.push({ op: has ? 'replace' : 'add', path, value });
  };
  const text = colour('text');
  const primary = colour('primary');
  const accent = colour('accent');
  const background = colour('background');

  recipe.scenes.forEach((scene, si) => {
    if (scene.background !== 'transparent') set(`/scenes/${si}/background`, true, scene.background, background);
    scene.layers.forEach((l, li) => {
      const at = `/scenes/${si}/layers/${li}`;
      if (l.type === 'text') {
        const family = l.role === 'title' ? kit.headingFont : kit.bodyFont;
        if (family && l.font !== family) ops.push({ op: 'replace', path: `${at}/font`, value: family });
        if (l.background) {
          set(`${at}/background`, true, l.background, primary);
          set(`${at}/colour`, true, l.colour, readable(primary ?? l.background));
        } else {
          set(`${at}/colour`, true, l.colour, text);
        }
      } else if (l.type === 'shape') {
        set(`${at}/fill`, true, l.fill, l.shape === 'line' || thin(l) ? (accent ?? primary) : primary);
      } else if (l.type === 'chart') {
        set(`${at}/colour`, true, l.colour, primary);
      }
    });
  });

  ops.push(...logoOps(recipe, kit));
  ops.push({ op: Object.hasOwn(recipe, 'brandApplied') ? 'replace' : 'add', path: '/brandApplied', value: true });
  return ops;
}

function logoAsset(id: string): Asset {
  const ext = logoExt(id);
  return { id, kind: 'logo', name: logoName(id), mime: MIME[ext] ?? 'image/png', bytes: 0, opfsPath: logoPath(id) };
}

/** Swaps the logo every logo layer shows; a clip with none gets a small one in the corner of its last scene. */
function logoOps(recipe: Recipe, kit: BrandKit): PatchOp[] {
  const id = kit.logoAssetId;
  if (!id) return [];
  const ops: PatchOp[] = [{ op: Object.hasOwn(recipe.assets, id) ? 'replace' : 'add', path: `/assets/${id}`, value: logoAsset(id) }];
  let found = false;
  recipe.scenes.forEach((scene, si) => scene.layers.forEach((l, li) => {
    if (l.type !== 'image' || recipe.assets[l.assetId]?.kind !== 'logo') return;
    found = true;
    if (l.assetId !== id) ops.push({ op: 'replace', path: `/scenes/${si}/layers/${li}/assetId`, value: id });
  }));
  const last = recipe.scenes[recipe.scenes.length - 1];
  if (!found && last) ops.push({ op: 'add', path: `/scenes/${recipe.scenes.length - 1}/layers/-`, value: cornerLogo(recipe, last, id) });
  return ops;
}

function cornerLogo(recipe: Recipe, scene: Scene, assetId: string): Layer {
  const { w: W, h: H } = canvasSize(recipe.aspect, 1080);
  const side = 0.12 * Math.min(W, H);
  const safe = safeBox(recipe.aspect);
  return {
    id: `brand-logo-${scene.id}`, name: 'Logo', type: 'image', assetId, fit: 'contain', startMs: 0, endMs: scene.durationMs, opacity: 1,
    box: { x: safe.x + 0.02, y: safe.y + 0.02, w: round(side / W), h: round(side / H) },
  };
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Fonts the kit's custom families need in the recipe's assets, so the clip carries them. */
export function brandFontAssets(kit: BrandKit): Asset[] {
  return customFamilies(kit).map((family) => ({ id: fontAssetId(family), kind: 'font', name: family, mime: 'font/ttf', bytes: 0, opfsPath: fontPath(family) }));
}
export const customFamilies = (kit: BrandKit): string[] =>
  [...new Set([kit.headingFont, kit.bodyFont])].filter((f): f is string => !!f && f !== BUILT_IN_FONT);

/** The ops of applyBrand plus the font files the new fonts need, as the one Change "Brand kit applied". */
export function brandEdit(recipe: Recipe, kit: BrandKit): { ops: PatchOp[]; summary: string } {
  const ops = applyBrand(recipe, kit);
  for (const a of brandFontAssets(kit)) ops.unshift({ op: Object.hasOwn(recipe.assets, a.id) ? 'replace' : 'add', path: `/assets/${a.id}`, value: a });
  return { ops, summary: 'Brand kit applied' };
}

// ---- Storing the kit (db.ts) and its files (OPFS) ----

export async function loadKit(): Promise<BrandKit> {
  return (await getBrandKit()) ?? emptyKit();
}

export async function saveLogo(file: File, old?: string): Promise<string> {
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? file.type.split('/')[1] ?? 'png').toLowerCase().replace('svg+xml', 'svg');
  const id = `brand-logo-${ext}`;
  await putMedia(logoPath(id), file);
  if (old && old !== id) await deleteMedia(logoPath(old)).catch(() => undefined);
  return id;
}

/** Stores the font file and loads it so it can be drawn at once. Returns its family name. */
export async function saveFont(file: File): Promise<string> {
  const family = familyFromFile(file.name);
  await putMedia(fontPath(family), file);
  await loadFont(family, file);
  return family;
}

const loaded = new Set<string>();
async function loadFont(family: string, blob: Blob): Promise<void> {
  if (loaded.has(family)) return;
  const face = new FontFace(family, await blob.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  loaded.add(family);
}

/** Loads the kit's custom fonts from OPFS into the page. A missing or broken file is logged and skipped. */
export async function registerBrandFonts(kit: BrandKit | undefined): Promise<void> {
  if (!kit) return;
  await Promise.all(customFamilies(kit).map(async (family) => {
    try {
      const file = await getMedia(fontPath(family));
      if (file) await loadFont(family, file);
    } catch (error) {
      console.error('Motikord: could not load brand font', error);
    }
  }));
}

/** Applies the saved kit to a stored clip as one Change by 'hand' (used when the editor itself is not running). */
export async function applyBrandToStoredClip(clipId: string): Promise<boolean> {
  const kit = await loadKit();
  const out = await updateClip(clipId, (clip) => {
    const edit = brandEdit(clip.recipe, kit);
    const now = Date.now();
    const done = record(clip.recipe, { past: clip.history, future: [] }, edit.ops, { by: 'hand', summary: edit.summary, at: now, id: crypto.randomUUID() });
    return { recipe: done.doc, history: done.history.past, updatedAt: now };
  });
  return !!out;
}
