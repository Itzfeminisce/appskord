import { captureProblem, type CaptureResult } from './result';

export interface PageRead {
  title: string;
  url: string;
  /** Visible text, whitespace collapsed, cut at `maxChars`. */
  text: string;
  words: number;
  /** Absolute og:image (or twitter:image) address, when the page names one. */
  previewUrl?: string;
}

// Runs inside the page; must not use anything from this module's scope.
function readInPage(maxChars: number): PageRead {
  const text = (document.body?.innerText ?? '').replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, maxChars);
  const meta = document.querySelector<HTMLMetaElement>('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]');
  let previewUrl: string | undefined;
  try {
    if (meta?.content) previewUrl = new URL(meta.content, location.href).href;
  } catch {
    previewUrl = undefined;
  }
  return { title: document.title || location.hostname, url: location.href, text, words: text ? text.split(/\s+/).length : 0, previewUrl };
}

/** Reads the tab's title, address, visible text and preview image address. Needs activeTab (or a host grant) on it. */
export async function readPage(tabId: number, maxChars = 200_000): Promise<CaptureResult<PageRead>> {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: readInPage, args: [maxChars] });
    if (!result?.result) return { ok: false, problem: 'failed', message: 'The page returned nothing.' };
    return { ok: true, value: result.result };
  } catch (error) {
    return captureProblem(error);
  }
}
