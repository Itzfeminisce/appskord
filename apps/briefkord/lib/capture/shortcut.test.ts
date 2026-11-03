import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { BoardMeta, Card } from '../board/types';
import { DEFAULT_SETTINGS, type Settings } from '../store/settings';
import type { SaveResult } from './save';
import { onGrant, recordGrant, saveFromShortcut, type ShortcutDeps } from './shortcut';

const meta = (id: string, updatedAt: number): BoardMeta => ({ id, name: id, pinned: false, cards: 0, updatedAt, bytes: 0 });
const tab = { id: 7, windowId: 1, url: 'https://example.com/a', title: 'A' };

function deps(settings: Partial<Settings>, result: SaveResult, boards = [meta('old', 1), meta('new', 2)]) {
  const d = {
    listBoards: vi.fn(async () => boards),
    loadSettings: vi.fn(async () => ({ ...DEFAULT_SETTINGS, ...settings })),
    savePage: vi.fn(async () => result),
    sendIntent: vi.fn(async () => undefined),
  };
  return d satisfies ShortcutDeps;
}

const saved = (offline?: boolean): SaveResult => ({ ok: true, board: {} as never, card: { id: 'card-1' } as Card, ...(offline ? { offline } : {}) });

beforeEach(() => fakeBrowser.reset());

describe('save shortcut', () => {
  it('saves to the last board and section, then shows the saved card', async () => {
    const d = deps({ lastBoardId: 'old', lastSectionId: 's2' }, saved());
    expect(await saveFromShortcut(tab, d)).toEqual({ route: '/saved/card-1', search: {} });
    expect(d.savePage).toHaveBeenCalledWith(tab, 'old', 's2');
    expect(d.sendIntent).toHaveBeenCalledWith({ route: '/saved/card-1', search: {} });
  });

  it('uses the newest board when the last one is gone, in its first section', async () => {
    const d = deps({ lastBoardId: 'deleted', lastSectionId: 's2' }, saved(true));
    expect(await saveFromShortcut(tab, d)).toEqual({ route: '/saved/card-1', search: { offline: '1' } });
    expect(d.savePage).toHaveBeenCalledWith(tab, 'new', undefined);
  });

  it('saves nothing with no board yet, or on a Chrome page', async () => {
    const none = deps({}, saved(), []);
    expect(await saveFromShortcut(tab, none)).toBeUndefined();
    const chromePage = deps({}, saved());
    expect(await saveFromShortcut({ ...tab, url: 'chrome://extensions' }, chromePage)).toBeUndefined();
    expect(chromePage.savePage).not.toHaveBeenCalled();
  });

  it('opens the panel home when the page cannot be read, with the low-space notice when space is low', async () => {
    expect(await saveFromShortcut(tab, deps({}, { ok: false, problem: 'cant-read', reason: 'restricted' }))).toEqual({ route: '/' });
    expect(await saveFromShortcut(tab, deps({}, { ok: false, problem: 'storage-low' }))).toEqual({ route: '/', notice: { kind: 'storage-low' } });
  });

  it('tells the panel when a click or the shortcut grants a tab', async () => {
    const seen: number[] = [];
    const off = onGrant((id) => seen.push(id));
    await recordGrant(7);
    off();
    await recordGrant(8);
    expect(seen).toEqual([7]);
  });
});
