// Dev tools only: `?clip=dev-issues` opens the bakery clip with seeded quality-check issues, two fixes and a critic note.
// Loaded behind __MOTIKORD_DEV_TOOLS__, so it never ships in the release zip.
import { devSampleV2 } from '../../lib/editor/v2';
import type { Change, Clip, CriticNote, Recipe, TextLayer } from '../../lib/types';

export const DEV_ISSUES_ID = 'dev-issues';

const textOf = (r: Recipe, si: number, slot: string) => r.scenes[si]!.layers.find((l): l is TextLayer => l.type === 'text' && l.slot === slot)!;

/** The sample clip with layout problems the checker finds (overlap, contrast, words off the safe area). */
export function devIssuesClip(now = Date.now()): Clip {
  const r = devSampleV2(DEV_ISSUES_ID);
  // Scene 7: the handle slides up onto the call to action.
  const handle = textOf(r, 6, 'handle');
  handle.boxes = { ...handle.boxes, '16:9': { ...handle.boxes!['16:9']!, y: 0.42 } };
  // Scene 6: the role slides onto the yellow band, where it no longer reads.
  const role = textOf(r, 5, 'role');
  role.boxes = { ...role.boxes, '16:9': { ...role.boxes!['16:9']!, x: 0.24, w: 0.71 } };
  // Scene 1: the headline spills past the safe area at the bottom.
  const headline = textOf(r, 0, 'headline');
  headline.boxes = { ...headline.boxes, '16:9': { ...headline.boxes!['16:9']!, h: 0.62 } };
  const fix = (id: string, summary: string, si: number, ms: number): Change => ({
    id, at: now - 60_000, by: 'check', summary,
    patch: [{ op: 'replace', path: `/scenes/${si}/durationMs`, value: ms }], inverse: [{ op: 'replace', path: `/scenes/${si}/durationMs`, value: ms }],
  });
  const history = [
    fix('dev-fix-1', 'Scene 2 headline cut to 6 words\nWas 9 words. The slot holds 6.', 1, r.scenes[1]!.durationMs),
    fix('dev-fix-2', 'Scene 4 swapped from List to Steps\nIts items read as steps.', 3, r.scenes[3]!.durationMs),
  ];
  return { id: DEV_ISSUES_ID, recipe: r, history, createdAt: now - 120_000, updatedAt: now };
}

/** The visual critic's note for the seeded clip. */
export const DEV_CRITIC: { notes: CriticNote[]; scenes: number[]; frames: number } = {
  notes: [{ sceneIndex: 2, problem: 'The yellow number is hard to read on the dark band', fix: 'Make the number white and put it on the plain ground.' }],
  scenes: [0, 2, 6], frames: 3,
};
