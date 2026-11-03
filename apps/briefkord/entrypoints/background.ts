import { lastUsedFirst } from '@/lib/capture/cards';
import { sendIntent, type PendingCapture } from '@/lib/capture/intent';
import { saveCapture, savePage } from '@/lib/capture/save';
import { recordGrant, SAVE_COMMAND, saveFromShortcut } from '@/lib/capture/shortcut';
import { onBoardChanged } from '@/lib/store/channel';
import { listBoards } from '@/lib/store/db';
import { loadSettings } from '@/lib/store/settings';

const ROOTS = [
  { id: 'image', title: 'Save image to Briefkord', context: 'image' },
  { id: 'selection', title: 'Save selection to Briefkord', context: 'selection' },
] as const;
const NEW_BOARD = 'new';
const MENU_BOARDS = 8;

// Chrome reads "&" in a menu title as a keyboard marker.
const menuTitle = (name: string) => name.replace(/&/g, '&&');

function createItem(item: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(item, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function buildMenus(): Promise<void> {
  const [boards, settings] = await Promise.all([listBoards(), loadSettings()]);
  const ordered = lastUsedFirst(boards, settings.lastBoardId).slice(0, MENU_BOARDS);
  await chrome.contextMenus.removeAll();
  for (const root of ROOTS) {
    const contexts: [`${chrome.contextMenus.ContextType}`] = [root.context];
    await createItem({ id: root.id, title: root.title, contexts });
    for (const board of ordered) await createItem({ id: `${root.id}|${board.id}`, parentId: root.id, title: menuTitle(board.name), contexts });
    await createItem({ id: `${root.id}|${NEW_BOARD}`, parentId: root.id, title: 'New board…', contexts });
  }
}

let building = Promise.resolve();
function rebuildMenus(): void {
  building = building.then(buildMenus).catch((error: unknown) => console.error('Briefkord: could not build the right-click menu', error));
}

// Selected text with its line breaks; the menu's own copy flattens them.
async function selectedText(tabId: number | undefined, fallback: string): Promise<string> {
  if (tabId === undefined) return fallback;
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => window.getSelection()?.toString() ?? '' });
    const text = typeof result?.result === 'string' ? result.result.trim() : '';
    return text || fallback;
  } catch {
    return fallback;
  }
}

async function onMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  const [root, target] = String(info.menuItemId).split('|');
  if (!target || !tab?.id) return;
  const page = { pageUrl: info.pageUrl ?? tab.url, pageTitle: tab.title };
  const capture: PendingCapture | undefined =
    root === 'image' && info.srcUrl
      ? { kind: 'image', tabId: tab.id, src: info.srcUrl, ...page }
      : root === 'selection' && info.selectionText
        ? { kind: 'selection', text: await selectedText(tab.id, info.selectionText), ...page }
        : undefined;
  if (!capture) return;
  if (target === NEW_BOARD) return sendIntent({ route: '/new', capture });
  const result = await saveCapture(capture, target);
  if (result.ok) return;
  if (result.problem === 'image-blocked') return sendIntent({ notice: { kind: 'image-blocked', boardId: target, tabId: tab.id, ...page } });
  if (result.problem === 'file-too-big') return sendIntent({ notice: { kind: 'file-too-big', name: result.name, bytes: result.bytes } });
  if (result.problem === 'storage-low') return sendIntent({ notice: { kind: 'storage-low' } });
  console.error('Briefkord: could not save to the board', result);
}

export default defineBackground(() => {
  // The icon opens the panel from action.onClicked, which also gives activeTab on the tab in front.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch((error: unknown) => {
    console.error('Briefkord: could not set the side panel behaviour', error);
  });

  chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((error: unknown) => console.error('Briefkord: could not open the side panel', error));
    if (tab.id !== undefined) recordGrant(tab.id).catch((error: unknown) => console.error('Briefkord: could not note the tab access', error));
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command !== SAVE_COMMAND || tab?.id === undefined) return;
    // Opened inside the key press, before any await, so Chrome allows it.
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    const info = { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title };
    recordGrant(tab.id)
      .then(() => saveFromShortcut(info, { listBoards, loadSettings, savePage, sendIntent }))
      .catch((error: unknown) => console.error('Briefkord: could not save the page from the shortcut', error));
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    // The panel shows what was saved, or why not; it must open inside the click.
    if (tab?.windowId !== undefined) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    onMenuClick(info, tab).catch((error: unknown) => console.error('Briefkord: could not save from the right-click menu', error));
  });

  // Boards change in the panel and board tabs; the panel also pings when its board list changes.
  onBoardChanged(rebuildMenus);
  browser.runtime.onMessage.addListener((message: unknown) => {
    if ((message as { type?: string } | null)?.type === 'boards-changed') rebuildMenus();
  });
  browser.storage.onChanged.addListener((changes, area) => {
    const last = (value: unknown) => (value as { lastBoardId?: string } | undefined)?.lastBoardId;
    if (area === 'local' && changes.settings && last(changes.settings.oldValue) !== last(changes.settings.newValue)) rebuildMenus();
  });
  rebuildMenus();
});
