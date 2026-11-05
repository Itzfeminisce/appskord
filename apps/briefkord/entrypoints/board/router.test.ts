import { createMemoryHistory } from '@appskord/platform/router';
import { describe, expect, it } from 'vitest';
import { createAppRouter } from './router';

describe('board tab routes', () => {
  it('opens a board from board.html#/b/<id>', async () => {
    const router = createAppRouter(createMemoryHistory({ initialEntries: ['/b/abc-123'] }));
    await router.load();
    const match = router.state.matches.at(-1)!;
    expect(match.routeId).toBe('/b/$id');
    expect(match.params).toEqual({ id: 'abc-123' });
  });
});
