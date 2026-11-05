/**
 * "Save this page" from the keyboard (command `save-page`) and the toolbar icon. Both give Briefkord activeTab on the
 * tab in front, which the side panel alone cannot get after the user switches tabs.
 */
import type { BoardMeta } from '../board/types';
import type { Settings } from '../store/settings';
import { lastUsedFirst } from './cards';
import type { PanelIntent } from './intent';
import type { SaveResult, TabInfo } from './save';
import { isChromePage } from './text';

export const SAVE_COMMAND = 'save-page';

/** Session key the background writes when a click or the shortcut grants access to a tab, so the panel looks again. */
export const TAB_GRANT_KEY = 'tabGrant';

export async function recordGrant(tabId: number): Promise<void> {
  await browser.storage.session.set({ [TAB_GRANT_KEY]: { tabId, at: Date.now() } });
}

/** Calls `listener` each time a grant is recorded; returns the unsubscribe. */
export function onGrant(listener: (tabId: number) => void): () => void {
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const grant = changes[TAB_GRANT_KEY]?.newValue as { tabId?: number } | undefined;
    if (area === 'session' && typeof grant?.tabId === 'number') listener(grant.tabId);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}

export interface ShortcutDeps {
  listBoards: () => Promise<BoardMeta[]>;
  loadSettings: () => Promise<Settings>;
  savePage: (tab: TabInfo, boardId: string, sectionId?: string) => Promise<SaveResult>;
  sendIntent: (intent: PanelIntent) => Promise<void>;
}

/** What the panel shows after a shortcut save. */
export function intentFor(result: SaveResult): PanelIntent {
  if (result.ok) return { route: `/saved/${result.card.id}`, search: result.offline ? { offline: '1' } : {} };
  if (result.problem === 'storage-low') return { route: '/', notice: { kind: 'storage-low' } };
  return { route: '/' };
}

/** Saves the tab to the last board and section used and tells the panel. With no board yet the panel shows first run. */
export async function saveFromShortcut(tab: TabInfo, deps: ShortcutDeps): Promise<PanelIntent | undefined> {
  const [boards, settings] = await Promise.all([deps.listBoards(), deps.loadSettings()]);
  const board = lastUsedFirst(boards, settings.lastBoardId)[0];
  if (!board || (tab.url && isChromePage(tab.url))) return undefined;
  const sectionId = board.id === settings.lastBoardId ? settings.lastSectionId : undefined;
  const result = await deps.savePage(tab, board.id, sectionId);
  if (!result.ok && result.problem === 'failed') console.error('Briefkord: could not save the page from the shortcut', result.error);
  const intent = intentFor(result);
  await deps.sendIntent(intent);
  return intent;
}
