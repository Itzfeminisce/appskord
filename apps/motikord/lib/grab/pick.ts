// Pure parts of Grab: what a page element is, what is taken from it, and what a table means as a chart.
import type { Credit, LicenceId } from '../types';

export type PickKind = 'headline' | 'text' | 'quote' | 'image' | 'logo' | 'table';
export const KIND_NAMES: Record<PickKind, string> = { headline: 'Headline', text: 'Text', quote: 'Quote', image: 'Image', logo: 'Logo', table: 'Table' };

/** Plain data the content script reads off an element, so classifying needs no DOM. */
export interface ElementInfo {
  tag: string;                       // lower case
  role?: string;
  text: string;                      // the element's visible text, whitespace not yet collapsed
  childElements: number;
  hint: string;                      // alt, aria-label, id, class and src joined: where "logo" shows up
  insideHeader: boolean;             // inside header, nav or a role=banner
  width: number; height: number;     // rendered size in CSS px
  src?: string; alt?: string; mime?: string;
  rows?: string[][];                 // a table's cells
  caption?: string;
}

export interface Pick {
  id: string; kind: PickKind;
  text?: string;                     // headline, text, quote
  name?: string;                     // what the side panel shows for a picture or table
  src?: string; mime?: string;       // pictures
  dataUrl?: string;                  // the picture's bytes, read inside the page
  width?: number; height?: number;
  rows?: string[][];                 // tables
  failed?: boolean;                  // the picture could not be read
}

export interface PageInfo { title: string; url: string; site: string; licenceHref?: string }

const HEADING = /^h[1-6]$/;
const TEXT_TAGS = new Set(['p', 'li', 'figcaption', 'dd', 'dt', 'pre']);
const LOGO_HINT = /logo|brand|wordmark/i;
const MIN_PICTURE = 48;
const MIN_LOGO = 16;
const MAX_TEXT = 2000;

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The kind of pick an element is, or undefined when clicking it should not pick anything. */
export function classifyElement(e: ElementInfo): PickKind | undefined {
  const tag = e.tag.toLowerCase();
  const text = squash(e.text);
  if (tag === 'img' || tag === 'svg' || tag === 'picture') {
    const logo = LOGO_HINT.test(e.hint) || (e.insideHeader && e.width <= 260 && e.height <= 140);
    if (logo && e.width >= MIN_LOGO && e.height >= MIN_LOGO) return 'logo';
    if (e.width < MIN_PICTURE && e.height < MIN_PICTURE) return undefined;
    return tag === 'img' || tag === 'picture' ? 'image' : undefined;
  }
  if (tag === 'table') return e.rows && e.rows.length > 0 ? 'table' : undefined;
  if (HEADING.test(tag) || e.role === 'heading') return text ? 'headline' : undefined;
  if (tag === 'blockquote' || tag === 'q') return text ? 'quote' : undefined;
  if (TEXT_TAGS.has(tag)) return text ? 'text' : undefined;
  // A bare span or div counts as text only when it holds words and nothing else.
  if (['div', 'span', 'a', 'em', 'strong', 'b', 'i'].includes(tag) && e.childElements === 0 && text.length >= 20) return 'text';
  return undefined;
}

/** Labels shown on the page: "Text · Click to add" while hovering, "Headline · Picked" once picked. */
export const hoverLabel = (kind: PickKind) => `${KIND_NAMES[kind]} · Click to add`;
export const pickedLabel = (kind: PickKind) => `${KIND_NAMES[kind]} · Picked`;

const fileName = (src: string | undefined) => {
  if (!src) return undefined;
  try {
    const last = new URL(src, 'https://x.invalid').pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch { return undefined; }
};

/** What is taken from a classified element. */
export function extractPick(e: ElementInfo, kind: PickKind, id: string): Pick {
  const base: Pick = { id, kind };
  switch (kind) {
    case 'headline': case 'text': case 'quote':
      return { ...base, text: squash(e.text).slice(0, MAX_TEXT) };
    case 'image': case 'logo': {
      const alt = squash(e.alt ?? '');
      return { ...base, src: e.src, mime: e.mime, width: Math.round(e.width), height: Math.round(e.height), name: alt || (kind === 'logo' ? 'Site logo' : fileName(e.src) ?? 'Image') };
    }
    case 'table': {
      const rows = (e.rows ?? []).map((r) => r.map(squash)).filter((r) => r.some((c) => c !== ''));
      return { ...base, rows, name: squash(e.caption ?? '') || rows[0]?.filter(Boolean).join(', ') || 'Table' };
    }
  }
}

const NUMBER = /^[-+−]?\s*[$€£¥]?\s*\d[\d,]*(\.\d+)?\s*%?$/;

/** "1,200" → 1200, "$4.50" → 4.5, "12%" → 12; undefined when the cell is not a number. */
export function parseNumber(cell: string): number | undefined {
  const s = squash(cell);
  if (!NUMBER.test(s)) return undefined;
  const n = Number(s.replace(/[$€£¥,%\s+]/g, '').replace('−', '-'));
  return Number.isFinite(n) ? n : undefined;
}

export const MAX_BARS = 8;

const yearLike = (cell: string) => /^(19|20)\d\d$/.test(squash(cell));

/** A table's first number column (not a column of years) as chart values, labelled by its first words or years column; undefined when the table is not numeric. */
export function tableToChart(rows: string[][]): { label: string; value: number }[] | undefined {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length < 2 || width < 2) return undefined;
  const headed = rows[0]!.every((c) => parseNumber(c) === undefined);
  const body = headed ? rows.slice(1) : rows;
  if (body.length === 0) return undefined;
  const cols = [...Array(width).keys()];
  const value = cols.find((c) => body.every((r) => parseNumber(r[c] ?? '') !== undefined) && !body.every((r) => yearLike(r[c] ?? '')));
  if (value === undefined) return undefined;
  const label = cols.find((c) => c !== value && body.every((r) => squash(r[c] ?? '') !== '' && (parseNumber(r[c]!) === undefined || yearLike(r[c]!))));
  return body.slice(0, MAX_BARS).map((r, i) => ({ label: label === undefined ? String(i + 1) : squash(r[label]!), value: parseNumber(r[value]!)! }));
}

/** Pages Chrome does not let an extension read: its own pages, the Web Store and PDFs. */
export function grabBlocked(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'file:') return true;
  if (u.hostname === 'chromewebstore.google.com') return true;
  if (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore')) return true;
  return /\.pdf$/i.test(u.pathname);
}

/** The Creative Commons licence a page links to with rel="license"; 'own' when it states none. */
export function licenceFromHref(href: string | undefined): LicenceId {
  if (!href) return 'own';
  let u: URL;
  try { u = new URL(href); } catch { return 'own'; }
  if (!/(^|\.)creativecommons\.org$/.test(u.hostname)) return 'own';
  const p = u.pathname.toLowerCase();
  if (p.startsWith('/publicdomain/zero')) return 'cc0';
  if (p.startsWith('/publicdomain/mark')) return 'pdm';
  const m = /^\/licenses\/(by(?:-[a-z]+)*)\//.exec(p);
  if (!m) return 'own';
  if (m[1] === 'by') return 'cc-by';
  if (m[1] === 'by-sa') return 'cc-by-sa';
  if (m[1] === 'by-nc') return 'cc-by-nc';
  return 'own';
}

/** Every picture taken from a page is credited to the page. */
export function pageCredit(page: PageInfo, pick: Pick): Credit {
  const licence = licenceFromHref(page.licenceHref);
  return {
    title: page.title || pick.name || page.site, author: page.site, source: 'page', url: page.url, licence,
    ...(licence !== 'own' && page.licenceHref ? { licenceUrl: page.licenceHref } : {}),
  };
}
