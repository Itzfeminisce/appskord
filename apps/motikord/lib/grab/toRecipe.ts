// Picks become context for makeClip (text in the prompt, pictures as assets) and, without an AI, plain scenes.
import { mediaPath } from '../media';
import type { Asset, ClipType, Layer, Recipe, Scene } from '../types';
import { KIND_NAMES, MAX_BARS, pageCredit, tableToChart, type PageInfo, type Pick } from './pick';

const isPicture = (p: Pick) => p.kind === 'image' || p.kind === 'logo';

/** The words that go to the AI with your prompt: every text, quote and table pick, with where it came from. */
export function picksToPrompt(picks: Pick[], page: PageInfo): string {
  const lines: string[] = [];
  for (const p of picks) {
    if (p.text) lines.push(`${KIND_NAMES[p.kind]}: ${p.text}`);
    else if (p.kind === 'table' && p.rows) {
      const bars = tableToChart(p.rows);
      lines.push(bars ? `Chart data (${p.name ?? 'Table'}): ${bars.map((b) => `${b.label} ${b.value}`).join(', ')}` : `Table (${p.name ?? 'Table'}): ${p.rows.map((r) => r.join(' | ')).join('; ')}`);
    }
  }
  const pics = picks.filter(isPicture).map((p) => `${KIND_NAMES[p.kind]} "${p.name ?? ''}"`);
  if (pics.length) lines.push(`Pictures from the page, attached: ${pics.join(', ')}`);
  if (lines.length === 0) return '';
  return [`From the page "${page.title || page.site}":`, ...lines].join('\n');
}

/** Your prompt with the picks' words added under it. */
export function withPicks(prompt: string, picks: Pick[], page: PageInfo): string {
  const added = picksToPrompt(picks, page);
  return [prompt.trim(), added].filter(Boolean).join('\n\n');
}

export interface AssetDeps { put(path: string, data: Blob): Promise<void>; id(): string }

/** Rejects a data URL that is not an image; returns its bytes. */
export function dataUrlToBlob(dataUrl: string): Blob | undefined {
  const m = /^data:(image\/[a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(dataUrl);
  if (!m) return undefined;
  const mime = m[1]!.toLowerCase();
  const bytes = m[2] ? Uint8Array.from(atob(m[3]!), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]!));
  return new Blob([bytes], { type: mime });
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

/** Stores each picked picture in OPFS and returns its asset, credited to the page. A picture that could not be read is skipped. */
export async function picksToAssets(picks: Pick[], page: PageInfo, deps: AssetDeps): Promise<{ assets: Asset[]; byPick: Record<string, Asset>; skipped: Pick[] }> {
  const assets: Asset[] = [];
  const byPick: Record<string, Asset> = {};
  const skipped: Pick[] = [];
  for (const p of picks.filter(isPicture)) {
    const blob = p.dataUrl ? dataUrlToBlob(p.dataUrl) : undefined;
    if (!blob) { skipped.push(p); continue; }
    const id = deps.id();
    const asset: Asset = {
      id, kind: p.kind === 'logo' ? 'logo' : 'image', name: p.name ?? KIND_NAMES[p.kind], mime: blob.type, bytes: blob.size,
      width: p.width, height: p.height, opfsPath: mediaPath(id, EXT[blob.type] ?? ''), credit: pageCredit(page, p),
    };
    await deps.put(asset.opfsPath, blob);
    assets.push(asset);
    byPick[p.id] = asset;
  }
  return { assets, byPick, skipped };
}

const SCENE_MS = 3000;
const FULL = { x: 0, y: 0, w: 1, h: 1 };

function sceneFor(p: Pick, index: number, assetOf: (p: Pick) => Asset | undefined): Scene | undefined {
  const base = { startMs: 0, endMs: SCENE_MS, opacity: 1 };
  const id = `s${index + 1}`;
  const scene = (background: string, layers: Layer[]): Scene => ({ id, durationMs: SCENE_MS, background, layout: 'center', layers });
  const text = (value: string, role: 'title' | 'body', size: number): Layer => ({
    ...base, id: `${id}-t`, name: KIND_NAMES[p.kind], type: 'text', role, text: value, font: 'Geist', sizePx: size, weight: role === 'title' ? 700 : 500,
    colour: '#FFFFFF', align: 'center', lineHeight: 1.2, box: { x: 0.08, y: 0.25, w: 0.84, h: 0.5 },
  });
  if (p.kind === 'headline') return scene('#111114', [text(p.text ?? '', 'title', 96)]);
  if (p.kind === 'quote') return scene('#111114', [text(`“${p.text ?? ''}”`, 'title', 72)]);
  if (p.kind === 'text') return scene('#111114', [text(p.text ?? '', 'body', 56)]);
  if (p.kind === 'table') {
    const values = p.rows ? tableToChart(p.rows) : undefined;
    if (values) return scene('#111114', [{ ...base, id: `${id}-c`, name: 'Chart', type: 'chart', chart: 'bar', values: values.slice(0, MAX_BARS), colour: '#EC4899', box: { x: 0.08, y: 0.2, w: 0.84, h: 0.6 } }]);
    return scene('#111114', [text((p.rows ?? []).map((r) => r.join('  ')).join('\n'), 'body', 48)]);
  }
  const asset = assetOf(p);
  if (!asset) return undefined;
  return scene(p.kind === 'logo' ? '#FFFFFF' : '#111114', [{ ...base, id: `${id}-i`, name: asset.name, type: 'image', assetId: asset.id, fit: p.kind === 'logo' ? 'contain' : 'cover', box: p.kind === 'logo' ? { x: 0.2, y: 0.3, w: 0.6, h: 0.4 } : FULL }]);
}

/** One scene per pick, in the order picked. `byPick` maps a picture pick's id to its stored asset. */
export function picksToRecipe(picks: Pick[], byPick: Record<string, Asset>, opts: { id: string; name: string; aspect: Recipe['aspect']; prompt?: string }): Recipe {
  const assetOf = (p: Pick) => byPick[p.id];
  const scenes = picks.map((p, i) => sceneFor(p, i, assetOf)).filter((s): s is Scene => s !== undefined);
  const used = new Set(scenes.flatMap((s) => s.layers).flatMap((l) => (l.type === 'image' ? [l.assetId] : [])));
  const type: ClipType = scenes.some((s) => s.layers.some((l) => l.type === 'chart')) ? 'chart' : picks.some(isPicture) ? 'promo' : picks.every((p) => p.kind === 'quote') ? 'quote' : 'explainer';
  return {
    version: 1, id: opts.id, name: opts.name, type, aspect: opts.aspect, scenes, prompt: opts.prompt,
    assets: Object.fromEntries(Object.values(byPick).filter((a) => used.has(a.id)).map((a) => [a.id, a])),
  };
}
