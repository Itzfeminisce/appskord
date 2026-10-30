import type { LicenceId } from '../types';
import { isFreeToUse, licenceName, openverseLicence } from './licence';

export type MediaKind = 'image' | 'video' | 'audio';
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One search hit, the same shape for every library. */
export interface MediaResult {
  id: string; source: 'openverse' | 'pexels'; kind: MediaKind;
  title: string; author: string; licence: LicenceId;
  /** "CC BY 4.0" */ licenceLabel: string; licenceUrl?: string;
  /** The page it lives on, for "See it on Openverse" and the credit link. */ pageUrl: string;
  thumbnail: string; downloadUrl: string; mime?: string;
  width?: number; height?: number; durationMs?: number;
}

/** offline: no connection. key: the library refused the key. failed: anything else. */
export class MediaSearchError extends Error {
  constructor(readonly reason: 'offline' | 'key' | 'failed', message: string) { super(message); this.name = 'MediaSearchError'; }
}

const API = 'https://api.openverse.org/v1';
const PAGE_SIZE = 24;

interface OvItem {
  id: string; title?: string | null; creator?: string | null; url?: string | null; foreign_landing_url?: string | null;
  license?: string; license_version?: string | null; license_url?: string | null; thumbnail?: string | null;
  width?: number | null; height?: number | null; filetype?: string | null; duration?: number | null;
}

export function openverseUrl(q: string, kind: 'image' | 'audio', allLicences: boolean, page = 1): string {
  const p = new URLSearchParams({ q, page_size: String(PAGE_SIZE), page: String(page) });
  // Commercial use plus modification keeps out NC and ND; "Show all licences" drops the filter.
  if (!allLicences) p.set('license_type', 'commercial,modification');
  return `${API}/${kind === 'image' ? 'images' : 'audio'}/?${p}`;
}

export function mapOpenverse(item: OvItem, kind: 'image' | 'audio', allLicences: boolean): MediaResult | undefined {
  const licence = openverseLicence(item.license);
  if (!licence || !item.url || !isFreeToUse(licence, allLicences)) return undefined;
  const mime = item.filetype ? `${kind}/${item.filetype.toLowerCase().replace('jpg', 'jpeg')}` : undefined;
  return {
    id: item.id, source: 'openverse', kind,
    title: item.title?.trim() || (kind === 'image' ? 'Untitled photo' : 'Untitled track'),
    author: item.creator?.trim() || 'Unknown',
    licence, licenceLabel: licenceName(licence, item.license_version ?? undefined), licenceUrl: item.license_url ?? undefined,
    pageUrl: item.foreign_landing_url || item.url,
    thumbnail: item.thumbnail || (kind === 'image' ? `${API}/images/${item.id}/thumb/` : ''),
    downloadUrl: item.url, mime,
    width: item.width ?? undefined, height: item.height ?? undefined, durationMs: item.duration ?? undefined,
  };
}

/** Sends only the search words and the licence filter; Openverse needs no key. */
export async function searchOpenverse(fetchFn: FetchLike, q: string, kind: 'image' | 'audio', allLicences: boolean): Promise<MediaResult[]> {
  let res: Response;
  try {
    res = await fetchFn(openverseUrl(q, kind, allLicences), { credentials: 'omit' });
  } catch {
    throw new MediaSearchError('offline', 'Could not reach Openverse.');
  }
  if (!res.ok) throw new MediaSearchError('failed', `Openverse answered ${res.status}.`);
  const body = (await res.json()) as { results?: OvItem[] };
  return (body.results ?? []).flatMap((item) => mapOpenverse(item, kind, allLicences) ?? []);
}
