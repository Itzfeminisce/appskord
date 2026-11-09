// What a v3 export makes, from the ExportV3 choice: one file per size, the frame rate, finishing and captions. Pure.
import type { ClipV3, SceneV3 } from '@appskord/motion/types';
import { CAPTION_PREFIX } from '../components/editor/CaptionsVoiceEdits';
import type { ExportChoiceV3 } from '../components/export/ExportV3';
import { creditsBox, frameSize, GIF_FPS, hasAudio, type RenderItem } from './exportPlan';
import { KIND_LABEL, slug, videoFileName } from './fileNames';
import type { JobChoice } from './exportJob';
import type { RestyledClip } from './restyle/restyle';
import type { FileKind } from './types';
import type { CaptionCue } from './voice/captions';
import { sceneLayerText } from './v3/text';

const isCaption = (id: string) => id.startsWith(CAPTION_PREFIX);
const QUALITY = '1080p' as const;

export const clipHasCaptions = (v3: ClipV3) => v3.scenes.some((s) => s.layers.some((l) => isCaption(l.id)));

/** 60 fps falls back to 30 when the machine check found 60 too slow, unless the person chose "Export at 60 anyway". */
export const exportFps = (picked: 30 | 60, fallback30: boolean): 30 | 60 => (picked === 60 && fallback30 ? 30 : picked);

/** The kinds the v3 runner draws; Lottie and see-through need what the renderer does not offer yet. */
export const v3Renders = (kind: ExportChoiceV3['kind']): kind is Exclude<FileKind, 'webm-alpha'> => kind === 'mp4' || kind === 'webm' || kind === 'gif';

/** The clip each file draws: caption layers are kept only when they are burnt in, and finishing follows the switch. */
export function drawnClip(v3: ClipV3, choice: Pick<ExportChoiceV3, 'captions' | 'finishing'>): ClipV3 {
  const scenes: SceneV3[] = choice.captions === 'burn' ? v3.scenes : v3.scenes.map((s) => ({ ...s, layers: s.layers.filter((l) => !isCaption(l.id)) }));
  return { ...v3, scenes, finish: { ...v3.finish, on: choice.finishing && v3.finish.on } };
}

/** The caption layers as cues on the clip's timeline, in order, for the .srt file. */
export function captionCues(clip: RestyledClip): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let start = 0;
  clip.v3.scenes.forEach((s, i) => {
    for (const l of s.layers) {
      if (!isCaption(l.id)) continue;
      const end = Math.max(0, ...(l.tracks.opacity ?? []).map((k) => k.t));
      const text = sceneLayerText(clip.recipe.scenes[i], l)?.trim();
      if (text) cues.push({ startMs: start + (l.start ?? 0), endMs: start + (l.start ?? 0) + end, text });
    }
    start += s.ms;
  });
  return cues.sort((a, b) => a.startMs - b.startMs);
}

export const srtFileName = (name: string) => `${slug(name)}.srt`;

/** The job's choice: one kind, the picked sizes, 1080p, and credits.txt as the v2 export decides it. */
export function jobChoiceV3(clip: RestyledClip, choice: ExportChoiceV3): JobChoice {
  const kind = choice.kind as FileKind;
  return { kinds: [kind], aspects: choice.aspects, quality: QUALITY, credits: creditsBox(clip.recipe).on };
}

/** One file per size, in render order, at the export's frame rate (GIFs stay at their own). */
export function planV3(clip: RestyledClip, choice: JobChoice, fps: 30 | 60): RenderItem[] {
  const durationMs = clip.v3.scenes.reduce((n, s) => n + s.ms, 0);
  const sound = hasAudio(clip.recipe);
  return choice.kinds.flatMap((kind) => choice.aspects.map((aspect): RenderItem => {
    const { w, h } = frameSize(aspect, kind, choice.quality);
    const rate = kind === 'gif' ? GIF_FPS : fps;
    return {
      aspect, kind, quality: choice.quality, file: videoFileName(clip.recipe.name, aspect, kind),
      label: `${aspect} · ${KIND_LABEL[kind]} · ${rate} fps`,
      width: w, height: h, fps: rate, frames: Math.max(1, Math.ceil((durationMs / 1000) * rate)), durationMs,
      audio: sound && kind !== 'gif', seeThrough: false,
      bitrate: Math.round(8_000_000 * ((w * h) / (1920 * 1080)) ** 0.75 * (rate / 30) ** 0.5),
    };
  }));
}
