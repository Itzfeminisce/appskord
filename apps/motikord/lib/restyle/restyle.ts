// "Restyle with v3 motion": same words, scenes and media; new motion, depth and finish. The words and media stay in
// the clip's recipe (v3 layers point at its layers by id), and the v2 recipe is kept whole so Changes can open it.
import type { TemplateId } from '@appskord/scenes';
import { validateClip } from '@appskord/motion/recipe';
import type { ClipV3, LayerV3, LookGuide, SceneV3 } from '@appskord/motion/types';
import { getPackV3, isPackId, packFinish, packLook, type PackId, type PackV3 } from '../look/packs';
import { buildScene, linkScenes, type LayerInput } from '../templates/v3/build';
import { getTemplateV3, type TemplateV3 } from '../templates/v3/templates';
import type { Change, Clip, Layer, Recipe, Scene } from '../types';

/** RestyleV2 and ChangesV3 copy. */
export const RESTYLE = {
  title: 'Restyle with v3 motion',
  line: 'Same words, scenes and media. New motion, depth and finish.',
  packLine: (pack: string) => `Keep ${pack}, or pick another of the 8.`,
  changes: ['Motion', 'Camera', 'Depth', 'Finish'],
  stays: ['Words', 'Scenes', 'Media', 'Timing'],
  keyFrames: 'Show me each key frame first',
  keyFramesLine: 'One still per scene in your look. Approve them, then Motikord adds the motion. No AI cost.',
  kept: 'Your v2 version stays in Changes.',
  notNow: 'Not now',
  go: 'Restyle',
  summary: (pack: string) => `Restyled with v3 motion · ${pack}`,
  keptHere: 'Your v2 version is kept here',
  v2Name: 'v2 version',
  v2Line: 'Before the restyle',
  open: 'Open v2 version',
  failed: {
    id: 'restyle-failed',
    title: 'Restyle didn’t finish',
    line: 'Your v2 clip is unchanged. Try again to restyle it with v3 motion.',
    action: 'Try again',
  },
} as const;

/** A library row after a restyle: the v3 recipe beside the words and media, and the v2 recipe as it was. */
export interface RestyledClip extends Clip {
  v3: ClipV3;
  v2Version: Recipe;
}
export const isRestyled = (clip: Clip): clip is RestyledClip => 'v3' in clip && 'v2Version' in clip;

export interface RestyleOptions {
  /** Defaults to the clip's own v2 pack ("Keep Bold"). */
  packId?: PackId;
  /** A saved look guide; defaults to the pack's. */
  lookGuide?: LookGuide;
  fps?: 30 | 60;
  /** "Show me each key frame first": scenes wait for approval in Check the key frames. */
  keyFramesFirst?: boolean;
  now: number;
  changeId: string;
}

const KIND: Record<Layer['type'], LayerV3['kind']> = {
  text: 'text',
  image: 'media',
  video: 'media',
  shape: 'shape',
  chart: 'chart',
};

/** A scene without a known template keeps its layers and takes the pack's camera and first transition. */
function looseTemplate(pack: PackV3): TemplateV3 {
  return {
    id: 'free' as TemplateId,
    number: '',
    name: '',
    packId: pack.id,
    keyFrameS: 0,
    slotLabels: [],
    beats: [],
    plan: [],
    camera: { move: pack.camera.move, amount: pack.camera.amount },
    transition: pack.transitions[0] ?? 'crossfade',
    sample: {},
  };
}

function sceneV3(scene: Scene, pack: PackV3, keyFramesFirst: boolean): SceneV3 {
  const t = (scene.template && getTemplateV3(scene.template)) || looseTemplate(pack);
  const layers: LayerInput[] = scene.layers.map((l) => ({
    id: l.id,
    kind: KIND[l.type],
    ...(l.slot ? { slotId: l.slot } : {}),
  }));
  const s = buildScene(t, pack, { id: scene.id, ms: scene.durationMs, layers });
  return keyFramesFirst ? { ...s, keyFrameApproved: false } : s;
}

/** The v2 clip as a v3 clip. Throws when the result fails the recipe check; the v2 clip is never changed. */
export function restyle(clip: Clip, o: RestyleOptions): RestyledClip {
  const v2 = clip.recipe;
  const pack = getPackV3(o.packId ?? (isPackId(v2.style) ? v2.style : 'clean'));
  const v3: ClipV3 = {
    version: 3,
    scenes: linkScenes(v2.scenes.map((s) => sceneV3(s, pack, !!o.keyFramesFirst))),
    lookGuideId: (o.lookGuide ?? packLook(pack)).id,
    packId: pack.id,
    fps: o.fps ?? 30,
    finish: packFinish(pack),
    restyledFrom: clip.id,
  };
  const checked = validateClip(v3);
  if (!checked.ok) throw new Error(`Motikord: could not restyle clip. ${checked.errors.join(' ')}`);
  const change: Change = {
    id: o.changeId,
    at: o.now,
    by: 'hand',
    summary: RESTYLE.summary(pack.name),
    patch: [{ op: 'add', path: '/v3', value: v3 }],
    inverse: [{ op: 'remove', path: '/v3' }],
  };
  return {
    ...clip,
    v3,
    v2Version: structuredClone(v2),
    history: [...clip.history, change],
    updatedAt: o.now,
  };
}

/** "Open v2 version": the clip as it was before the restyle, playing through @appskord/scenes again. */
export function openV2Version(clip: RestyledClip): Clip {
  const { v3: _v3, v2Version, ...rest } = clip;
  return { ...rest, recipe: structuredClone(v2Version) };
}

/** Every word the clip shows: text layers and the text in template slots. */
export function clipWords(recipe: Recipe): string[] {
  return recipe.scenes.flatMap((s) => [
    ...s.layers.flatMap((l) => (l.type === 'text' ? [l.text] : [])),
    ...Object.values(s.slots ?? {}).flatMap((v) =>
      typeof v === 'string' ? [v] : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x.label)) : [],
    ),
  ]);
}

/** Every media id the clip uses: media layers, media slots and its assets. */
export function clipMediaIds(recipe: Recipe): string[] {
  const ids = new Set(Object.keys(recipe.assets));
  for (const s of recipe.scenes) {
    for (const l of s.layers) if (l.type === 'image' || l.type === 'video') ids.add(l.assetId);
    for (const v of Object.values(s.slots ?? {}))
      if (v && typeof v === 'object' && !Array.isArray(v) && 'assetId' in v) ids.add(v.assetId);
  }
  return [...ids].sort();
}
