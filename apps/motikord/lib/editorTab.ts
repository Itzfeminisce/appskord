type TabContext = { tabId: number; windowId: number; documentUrl?: string };
type GetContexts = (filter: { contextTypes: chrome.runtime.ContextType[] }) => Promise<TabContext[]>;

/** The clip a document shows: the hash route's `clip` once the router has run, else the query's. */
function clipOf(url: URL): string | undefined {
  const hash = url.hash.indexOf('?');
  const fromHash = hash >= 0 ? new URLSearchParams(url.hash.slice(hash + 1)).get('clip') : null;
  return fromHash ?? url.searchParams.get('clip') ?? undefined;
}

/** The editor tab already open on `clipId`, matched with the hash route removed. */
export async function findEditorTab(getContexts: GetContexts, editorUrl: string, clipId?: string): Promise<TabContext | undefined> {
  const contexts = await getContexts({ contextTypes: [chrome.runtime.ContextType.TAB] });
  return contexts.find((context) => {
    if (!context.documentUrl || context.tabId < 0) return false;
    const page = context.documentUrl.split(/[?#]/, 1)[0];
    return page === editorUrl && clipOf(new URL(context.documentUrl)) === clipId;
  });
}

/** Why the editor's clip is missing: removed because its make stopped, or deleted. */
export type GoneReason = 'unfinished' | 'deleted';
export const goneReason = (clipId: string | undefined, unfinished: unknown): GoneReason => (clipId !== undefined && unfinished === clipId ? 'unfinished' : 'deleted');
