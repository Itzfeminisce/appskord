import { describe, expect, it } from 'vitest';
import { check } from '../../lib/checker';
import { groupIssues } from '../../screens/Checker';
import { DEV_CRITIC, devIssuesClip } from './devIssues';

describe('dev-issues sample clip', () => {
  it('has layout cards, two fixes by the check and a critic note on a scene it has', () => {
    const clip = devIssuesClip(0);
    expect(groupIssues(check(clip.recipe)).length).toBeGreaterThanOrEqual(3);
    expect(clip.history.filter((c) => c.by === 'check')).toHaveLength(2);
    expect(clip.recipe.scenes[DEV_CRITIC.notes[0]!.sceneIndex]).toBeDefined();
  });
});
