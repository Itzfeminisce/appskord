/** Pure helpers for what a capture saves: page text, word counts, site names and titles. */

/** Visible page text with runs of spaces and blank lines collapsed, cut at `maxChars` on a word boundary. */
export function cleanText(raw: string, maxChars = 200_000): string {
  const text = raw.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.search(/\s\S*$/);
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** "baymard.com" for https://www.baymard.com/blog; the address itself when it has no host. */
export function siteName(url: string): string {
  try {
    const { hostname, protocol } = new URL(url);
    if (!hostname) return protocol === 'file:' ? 'File on this computer' : url;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Pages Chrome never lets an extension read or save from: its own pages, other extensions, the Web Store. */
export function isChromePage(url: string): boolean {
  if (/^(chrome|edge|brave|about|chrome-untrusted|devtools|view-source|chrome-search):/i.test(url)) return true;
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === 'chromewebstore.google.com' || (hostname === 'chrome.google.com' && pathname.startsWith('/webstore'));
  } catch {
    return false;
  }
}

/** A one-line title from free text: its first line, cut at `max` characters on a word boundary with an ellipsis. */
export function titleFrom(text: string, max = 80): string {
  const line = text.trim().split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The name an image is saved under: the last part of its address, or `image` with the right extension. */
export function imageFileName(src: string, mime: string): string {
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') ?? 'png';
  try {
    const { pathname, protocol } = new URL(src);
    if (protocol === 'data:' || protocol === 'blob:') return `image.${ext}`;
    const last = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');
    if (!last) return `image.${ext}`;
    return /\.[a-z0-9]{2,5}$/i.test(last) ? last : `${last}.${ext}`;
  } catch {
    return `image.${ext}`;
  }
}

/** "2,140" */
export const formatCount = (n: number): string => n.toLocaleString('en-US');

/** "12 min ago", "1 h ago", "yesterday", "2 Nov": how the panel says when something happened. */
export function ago(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const day = (t: number) => new Date(t).toDateString();
  if (day(then) === day(now)) return `${Math.floor(minutes / 60)} h ago`;
  if (day(then) === day(now - 86_400_000)) return 'yesterday';
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "today", "yesterday", "2 Nov": the day something happened. */
export function onDay(then: number, now: number): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(then) === day(now)) return 'today';
  if (day(then) === day(now - 86_400_000)) return 'yesterday';
  return new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** "84 MB", "1.8 GB", "402 KB" */
export function formatBytes(bytes: number): string {
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const shown = unit >= 3 && value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}
