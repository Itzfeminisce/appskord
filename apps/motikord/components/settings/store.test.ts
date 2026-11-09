import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULTS_V3, getMachineResult, getV3, mergeV3, saveMachineResult, updateV3, when } from './store';

describe('v3 settings store', () => {
  beforeEach(() => fakeBrowser.reset());

  it('defaults: finishing on, 60 fps, auto preview, key frames first on, captions and voiceover off', () => {
    expect(DEFAULTS_V3).toEqual({ style: 'auto', finishing: true, fps: 60, previewQuality: 'auto', keyFramesFirst: true, captions: false, voiceover: false });
    expect(mergeV3(undefined)).toEqual(DEFAULTS_V3);
  });

  it('keeps valid values and replaces invalid ones with the defaults', () => {
    expect(mergeV3({ style: 'gloss', finishing: false, fps: 30, previewQuality: 'light', keyFramesFirst: false, captions: true, voiceover: true }))
      .toEqual({ style: 'gloss', finishing: false, fps: 30, previewQuality: 'light', keyFramesFirst: false, captions: true, voiceover: true });
    expect(mergeV3({ style: 'neon', finishing: 'yes', fps: 24, previewQuality: 'ultra', captions: 1 })).toEqual(DEFAULTS_V3);
  });

  it('persists each setting across reads', async () => {
    await updateV3({ finishing: false });
    await updateV3({ fps: 30, previewQuality: 'full' });
    await updateV3({ keyFramesFirst: false, captions: true, voiceover: true });
    expect(await getV3()).toEqual({ style: 'auto', finishing: false, fps: 30, previewQuality: 'full', keyFramesFirst: false, captions: true, voiceover: true });
  });

  it('remembers the machine check and says when it ran', async () => {
    expect(await getMachineResult()).toBeUndefined();
    await saveMachineResult({ at: 1000, fps60: true });
    expect(await getMachineResult()).toEqual({ at: 1000, fps60: true });
    const day = 86_400_000;
    expect([when(0, 1000), when(0, day), when(0, 3 * day)]).toEqual(['today', 'yesterday', '3 days ago']);
  });
});
