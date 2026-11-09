import { describe, expect, it } from 'vitest';
import { writeCaptions } from '../components/editor/CaptionsVoiceEdits';
import { sampleClip } from '../components/editor/fixture';
import { initV3 } from '../components/editor/model';
import type { ExportChoiceV3 } from '../components/export/ExportV3';
import { captionCues, clipHasCaptions, drawnClip, exportFps, jobChoiceV3, planV3, srtFileName, v3Renders } from './exportV3';
import { toSrt } from './voice/captions';

const choice = (c: Partial<ExportChoiceV3> = {}): ExportChoiceV3 => ({ kind: 'mp4', aspects: ['9:16', '16:9'], fps: 60, finishing: true, captions: 'burn', ...c });
const withCaptions = () => {
  const clip = sampleClip();
  const cues = [{ startMs: 200, endMs: 1400, text: 'Fresh every morning' }, { startMs: 1600, endMs: 2600, text: 'Come early' }];
  return writeCaptions(initV3(clip), cues, 'line', 'Auto captions added').clip;
};

describe('v3 export plan', () => {
  it('makes one file per size at the export frame rate, 1080p, for the clip length', () => {
    const clip = sampleClip();
    const ms = clip.v3.scenes.reduce((n, s) => n + s.ms, 0);
    const items = planV3(clip, jobChoiceV3(clip, choice()), 60);
    expect(items.map((i) => [i.aspect, i.width, i.height, i.fps])).toEqual([['9:16', 1080, 1920, 60], ['16:9', 1920, 1080, 60]]);
    expect(items[0]!.frames).toBe(Math.ceil((ms / 1000) * 60));
    expect(items[0]!.file).toMatch(/-9x16\.mp4$/);
    expect(planV3(clip, jobChoiceV3(clip, choice({ kind: 'gif', aspects: ['1:1'] })), 60)[0]!.fps).toBe(15);
  });

  it('falls back to 30 fps only when 60 was picked and the machine check said no', () => {
    expect(exportFps(60, true)).toBe(30);
    expect(exportFps(60, false)).toBe(60);
    expect(exportFps(30, false)).toBe(30);
  });

  it('draws MP4, WebM and GIF; Lottie and see-through are not drawn yet', () => {
    expect(['mp4', 'webm', 'gif', 'webm-alpha', 'lottie'].map((k) => v3Renders(k as never))).toEqual([true, true, true, false, false]);
  });

  it('keeps captions burnt in, or strips them for a separate .srt; finishing follows the switch', () => {
    const clip = withCaptions();
    expect(clipHasCaptions(clip.v3)).toBe(true);
    expect(clipHasCaptions(drawnClip(clip.v3, { captions: 'burn', finishing: true }))).toBe(true);
    const srt = drawnClip(clip.v3, { captions: 'srt', finishing: false });
    expect(clipHasCaptions(srt)).toBe(false);
    expect(srt.finish.on).toBe(false);
    expect(clipHasCaptions(sampleClip().v3)).toBe(false);
  });

  it('turns the caption layers back into cues on the clip timeline for the .srt', () => {
    const clip = withCaptions();
    const cues = captionCues(clip);
    expect(cues.map((c) => c.text)).toEqual(expect.arrayContaining(['Fresh every morning', 'Come early']));
    expect(cues[0]!.startMs).toBe(200);
    expect(toSrt(cues)).toContain('00:00:00,200 --> ');
    expect(srtFileName(clip.recipe.name)).toMatch(/\.srt$/);
  });
});
