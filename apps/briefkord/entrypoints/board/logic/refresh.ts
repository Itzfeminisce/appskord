/** "Refresh from the page": reads the page again only from a tab that already has it open; otherwise the saved copy stays. */
import { readPage, type PageRead } from '@/lib/capture/readPage';

export async function readOpenPage(url: string): Promise<PageRead | undefined> {
  try {
    const want = url.replace(/#.*$/, '');
    // Without the tabs permission Chrome only reports tabs we may read, which are exactly the ones we can refresh from.
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.id !== undefined && t.url?.replace(/#.*$/, '') === want);
    if (!tab?.id) return undefined;
    const read = await readPage(tab.id);
    return read.ok ? read.value : undefined;
  } catch (error) {
    console.error('Briefkord: could not refresh the page', error);
    return undefined;
  }
}
