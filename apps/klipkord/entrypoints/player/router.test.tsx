// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mount } from '../../test/mountRouter';
import { player } from './router';

describe('player window route', () => {
  it('renders the player, and a reload keeps it on the same recording and time', async () => {
    const view = await mount(player, 'Review', '/Review?recording=rec-1&at=2000');
    expect(view.router.route).toEqual({ screen: 'Review', params: { recordingId: 'rec-1', atMs: 2000 } });
    expect(view.host.innerHTML).not.toBe('');
  });
});
