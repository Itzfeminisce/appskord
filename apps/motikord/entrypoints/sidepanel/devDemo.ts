// Dev tools only: sample runs for `#/dev/Making`, `#/dev/MakingCheck`, `#/dev/StoryboardEdit` and `#/dev/MakingFailed`.
// Loaded behind devTools; the sample words are the frames' illustration and never ship in the release zip.
import { runner, type RunState } from '../../lib/makeClip';
import { expandScene } from '../../lib/templates/expand';
import { getPack } from '../../lib/templates/scenes';
import type { Beat, Recipe, Scene, Storyboard } from '../../lib/types';

const BEATS: Beat[] = [
  { template: 'title-hook', line: 'Fresh sourdough, baked here at 5am', ms: 3000 },
  { template: 'hero', line: 'Crackling crust and a soft crumb', ms: 4000 },
  { template: 'list', line: 'Classic, rye, seeded and olive loaves', ms: 4000 },
  { template: 'list', line: 'Order ahead, pick up warm bread', ms: 4000 },
  { template: 'end-card', line: 'Order today. Open 7 to 3', ms: 3000 },
];
const plan = (beats: Beat[]): Storyboard => ({ name: 'Fresh sourdough', hook: 'Fresh sourdough', style: 'bold', beats });
const SLOTS: Record<string, Scene['slots']> = {
  'title-hook': { kicker: 'Baked at 5am', headline: 'Fresh sourdough' },
  hero: { headline: 'Crackling crust', line: 'Soft crumb' },
  list: { title: 'Our loaves', items: ['Classic', 'Rye', 'Seeded', 'Olive'] },
  steps: { title: 'Order ahead', steps: ['Pick loaves', 'Choose a time', 'Collect warm'] },
  'end-card': { cta: 'Order today', handle: 'rise.bakery' },
};

function recipe(beats: Beat[]): Recipe {
  const pack = getPack('bold')!;
  const scenes = beats.map((b, i) => expandScene({ id: `demo-${i}`, durationMs: b.ms, background: pack.palette.bg, layout: 'center', layers: [], template: b.template, slots: SLOTS[b.template] }, pack));
  return { version: 2, id: 'demo', name: 'Fresh sourdough', type: 'promo', aspect: '9:16', scenes, assets: {}, style: 'bold', pace: 'normal', mood: 'upbeat' };
}

const BASE: RunState = {
  status: 'running', steps: 2, look: { style: 'bold', pace: 'normal', mood: 'upbeat' }, filled: 0, total: 5, fixes: [], issuesLeft: [],
  pausing: false, paused: false, notices: [], editorOpen: false, busyRetries: 0, type: 'promo', typeBy: 'groq', by: 'groq',
};

/** Shows the sample run for a dev screen; returns the screen to open. */
export function devDemo(screen: string): string {
  const checked = BEATS.map((b, i) => (i === 3 ? { ...b, template: 'steps' as const } : b));
  if (screen === 'Making') runner.show({ ...BASE, step: 'fill', storyboard: plan(BEATS), filled: 2, filling: 2 });
  if (screen === 'MakingCheck') {
    runner.show({
      ...BASE, steps: 3, step: 'critic', storyboard: plan(checked), filled: 5, recipe: recipe(checked),
      fixes: ['Scene 2 headline cut to 6 words', 'Scene 4 swapped from List to Steps (its items read as steps)'],
      critic: { scenes: [0, 1, 3], frames: 3, notes: [] },
    });
    return 'Making';
  }
  if (screen === 'StoryboardEdit') {
    const lines = ['Fresh sourdough, baked here at 5am', 'Crackling crust and a soft, open crumb', 'Classic, rye, seeded, olive and spelt loaves', 'Order ahead, pick up warm bread', 'Order today at rise.bakery'];
    runner.show({ ...BASE, step: 'fill', paused: true, storyboard: plan(checked.map((b, i) => ({ ...b, line: lines[i] ?? b.line }))) });
  }
  if (screen === 'MakingFailed') runner.show({ ...BASE, status: 'failed', failure: 'making-failed', step: 'check', storyboard: plan(BEATS) });
  return screen;
}
