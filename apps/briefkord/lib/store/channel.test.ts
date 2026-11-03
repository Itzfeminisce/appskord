import { describe, expect, it, vi } from 'vitest';
import { CHANNEL_NAME, onBoardChanged, postBoardChanged } from './channel';

describe('board channel', () => {
  it('delivers board-changed to listeners and ignores other messages', async () => {
    const seen: string[] = [];
    const stop = onBoardChanged((id) => seen.push(id));
    const other = new BroadcastChannel(CHANNEL_NAME);
    other.postMessage({ type: 'something-else', id: 'x' });
    other.postMessage({ type: 'board-changed' });
    other.close();
    postBoardChanged('b1');
    await vi.waitFor(() => expect(seen).toEqual(['b1']));
    stop();
  });
});
